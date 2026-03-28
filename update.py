import os
from datetime import datetime
import pandas as pd
import psycopg2
from vnstock import Quote

DB_URL = os.environ["DB_URL"]


def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calc_macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd = ema_fast - ema_slow
    macd_signal = macd.ewm(span=signal, adjust=False).mean()
    macd_hist = macd - macd_signal
    return macd, macd_signal, macd_hist


def detect_price_action(df: pd.DataFrame) -> str:
    if len(df) < 3:
        return "neutral"

    last = df.iloc[-1]
    prev = df.iloc[-2]

    bullish_engulfing = (
        prev["close"] < prev["open"]
        and last["close"] > last["open"]
        and last["open"] <= prev["close"]
        and last["close"] >= prev["open"]
    )
    bearish_engulfing = (
        prev["close"] > prev["open"]
        and last["close"] < last["open"]
        and last["open"] >= prev["close"]
        and last["close"] <= prev["open"]
    )

    body = abs(last["close"] - last["open"])
    candle_range = last["high"] - last["low"] if pd.notna(last["high"]) and pd.notna(last["low"]) else 0
    lower_wick = min(last["open"], last["close"]) - last["low"] if pd.notna(last["low"]) else 0
    upper_wick = last["high"] - max(last["open"], last["close"]) if pd.notna(last["high"]) else 0

    pinbar_bull = candle_range > 0 and lower_wick > body * 2 and upper_wick < body * 1.2
    pinbar_bear = candle_range > 0 and upper_wick > body * 2 and lower_wick < body * 1.2

    if bullish_engulfing:
        return "bullish_engulfing"
    if bearish_engulfing:
        return "bearish_engulfing"
    if pinbar_bull:
        return "bullish_pinbar"
    if pinbar_bear:
        return "bearish_pinbar"
    return "neutral"


def normalize_history_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return pd.DataFrame()

    work = df.copy()
    work.columns = [str(c).lower() for c in work.columns]

    rename_map = {}
    if "time" in work.columns:
        rename_map["time"] = "ts"
    elif "date" in work.columns:
        rename_map["date"] = "ts"
    elif "datetime" in work.columns:
        rename_map["datetime"] = "ts"

    work = work.rename(columns=rename_map)

    required = ["ts", "open", "high", "low", "close", "volume"]
    for col in required:
        if col not in work.columns:
            raise ValueError(f"Missing column: {col}")

    work["ts"] = pd.to_datetime(work["ts"])
    for col in ["open", "high", "low", "close", "volume"]:
        work[col] = pd.to_numeric(work[col], errors="coerce")

    work = work.dropna(subset=["ts", "close"])
    work = work.sort_values("ts").reset_index(drop=True)
    return work


def upsert_price_bars(cur, symbol: str, df: pd.DataFrame):
    for _, row in df.iterrows():
        cur.execute(
            """
            insert into price_bars
            (symbol, timeframe, ts, open, high, low, close, volume, source)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (symbol, timeframe, ts) do update set
              open = excluded.open,
              high = excluded.high,
              low = excluded.low,
              close = excluded.close,
              volume = excluded.volume,
              source = excluded.source
            """,
            (
                symbol,
                "1D",
                row["ts"].to_pydatetime(),
                float(row["open"]) if pd.notna(row["open"]) else None,
                float(row["high"]) if pd.notna(row["high"]) else None,
                float(row["low"]) if pd.notna(row["low"]) else None,
                float(row["close"]) if pd.notna(row["close"]) else None,
                float(row["volume"]) if pd.notna(row["volume"]) else None,
                "vnstock",
            ),
        )


def upsert_signal(cur, symbol: str, df: pd.DataFrame):
    if len(df) < 35:
        return

    work = df.copy()

    work["ma20"] = work["close"].rolling(20).mean()
    work["ma50"] = work["close"].rolling(50).mean()
    work["ma100"] = work["close"].rolling(100).mean()
    work["rsi"] = calc_rsi(work["close"], 14)
    work["macd"], work["macd_signal"], work["macd_hist"] = calc_macd(work["close"])

    last = work.iloc[-1]

    bullish_ma = (
        pd.notna(last["ma20"])
        and pd.notna(last["ma50"])
        and last["close"] > last["ma20"] > last["ma50"]
    )
    bullish_macd = (
        pd.notna(last["macd"])
        and pd.notna(last["macd_signal"])
        and last["macd"] > last["macd_signal"]
    )
    overbought = pd.notna(last["rsi"]) and last["rsi"] >= 70
    oversold = pd.notna(last["rsi"]) and last["rsi"] <= 30
    price_action = detect_price_action(work.tail(5))

    cur.execute(
        """
        insert into stock_signals
        (symbol, ts, close, rsi, ma20, ma50, ma100, macd, macd_signal, macd_hist,
         price_action, bullish_ma, bullish_macd, overbought, oversold)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (symbol, ts) do update set
          close = excluded.close,
          rsi = excluded.rsi,
          ma20 = excluded.ma20,
          ma50 = excluded.ma50,
          ma100 = excluded.ma100,
          macd = excluded.macd,
          macd_signal = excluded.macd_signal,
          macd_hist = excluded.macd_hist,
          price_action = excluded.price_action,
          bullish_ma = excluded.bullish_ma,
          bullish_macd = excluded.bullish_macd,
          overbought = excluded.overbought,
          oversold = excluded.oversold
        """,
        (
            symbol,
            last["ts"].to_pydatetime(),
            float(last["close"]) if pd.notna(last["close"]) else None,
            float(last["rsi"]) if pd.notna(last["rsi"]) else None,
            float(last["ma20"]) if pd.notna(last["ma20"]) else None,
            float(last["ma50"]) if pd.notna(last["ma50"]) else None,
            float(last["ma100"]) if pd.notna(last["ma100"]) else None,
            float(last["macd"]) if pd.notna(last["macd"]) else None,
            float(last["macd_signal"]) if pd.notna(last["macd_signal"]) else None,
            float(last["macd_hist"]) if pd.notna(last["macd_hist"]) else None,
            price_action,
            bullish_ma,
            bullish_macd,
            overbought,
            oversold,
        ),
    )


def main():
    print("Starting price update...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("select symbol from stocks order by symbol")
    symbols = [row[0] for row in cur.fetchall()]
    print("Symbols:", symbols)

    for symbol in symbols:
        try:
            quote = Quote(symbol=symbol, source="VCI")
            raw_df = quote.history(
                start="2024-01-01",
                end=datetime.now().strftime("%Y-%m-%d"),
                interval="1D"
            )

            df = normalize_history_df(raw_df)
            if df.empty:
                print(f"No data for {symbol}")
                continue

            upsert_price_bars(cur, symbol, df.tail(180))
            upsert_signal(cur, symbol, df.tail(180))

            conn.commit()
            print(f"Done {symbol}")
        except Exception as e:
            conn.rollback()
            print(f"Error {symbol}: {e}")

    cur.close()
    conn.close()
    print("Finished price update.")


if __name__ == "__main__":
    main()
