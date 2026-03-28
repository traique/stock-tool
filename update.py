import os
from datetime import datetime

import pandas as pd
import psycopg2
from vnstock import Quote

DB_URL = os.environ["DB_URL"]


def calc_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calc_macd(series):
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return macd, signal, hist


def normalize_df(df):
    if df is None or len(df) == 0:
        return pd.DataFrame()

    work = df.copy()
    work.columns = [str(c).lower() for c in work.columns]

    if "time" in work.columns:
        work = work.rename(columns={"time": "ts"})
    elif "date" in work.columns:
        work = work.rename(columns={"date": "ts"})
    elif "datetime" in work.columns:
        work = work.rename(columns={"datetime": "ts"})

    required = ["ts", "open", "high", "low", "close", "volume"]
    for col in required:
        if col not in work.columns:
            raise Exception(f"Thiếu cột {col}. Các cột hiện có: {list(work.columns)}")

    work["ts"] = pd.to_datetime(work["ts"])

    for col in ["open", "high", "low", "close", "volume"]:
        work[col] = pd.to_numeric(work[col], errors="coerce")

    work = work.dropna(subset=["ts", "close"])
    work = work.sort_values("ts").reset_index(drop=True)
    return work


def detect_price_action(df):
    if len(df) < 2:
        return "neutral"

    last = df.iloc[-1]
    prev = df.iloc[-2]

    bullish_engulfing = bool(
        prev["close"] < prev["open"]
        and last["close"] > last["open"]
        and last["open"] <= prev["close"]
        and last["close"] >= prev["open"]
    )

    bearish_engulfing = bool(
        prev["close"] > prev["open"]
        and last["close"] < last["open"]
        and last["open"] >= prev["close"]
        and last["close"] <= prev["open"]
    )

    body = abs(float(last["close"]) - float(last["open"]))
    candle_range = (
        float(last["high"]) - float(last["low"])
        if pd.notna(last["high"]) and pd.notna(last["low"])
        else 0
    )
    lower_wick = (
        min(float(last["open"]), float(last["close"])) - float(last["low"])
        if pd.notna(last["low"])
        else 0
    )
    upper_wick = (
        float(last["high"]) - max(float(last["open"]), float(last["close"]))
        if pd.notna(last["high"])
        else 0
    )

    bullish_pinbar = candle_range > 0 and lower_wick > body * 2 and upper_wick < body * 1.2
    bearish_pinbar = candle_range > 0 and upper_wick > body * 2 and lower_wick < body * 1.2

    if bullish_engulfing:
        return "bullish_engulfing"
    if bearish_engulfing:
        return "bearish_engulfing"
    if bullish_pinbar:
        return "bullish_pinbar"
    if bearish_pinbar:
        return "bearish_pinbar"
    return "neutral"


def build_expert_note(last):
    notes = []

    ma20 = last["ma20"]
    ma50 = last["ma50"]
    ma100 = last["ma100"]
    close = last["close"]
    rsi = last["rsi"]
    macd = last["macd"]
    macd_signal = last["macd_signal"]
    volume_ratio = last["volume_ratio"]

    if (
        pd.notna(close)
        and pd.notna(ma20)
        and pd.notna(ma50)
        and pd.notna(ma100)
        and close > ma20 > ma50 > ma100
    ):
        notes.append("Xu hướng tăng khỏe")
    elif pd.notna(close) and pd.notna(ma20) and close > ma20:
        notes.append("Giá nằm trên MA20")
    else:
        notes.append("Xu hướng chưa mạnh")

    if pd.notna(rsi):
        if 50 <= rsi <= 70:
            notes.append("Động lượng tích cực")
        elif rsi > 70:
            notes.append("Đang quá mua")
        elif rsi < 30:
            notes.append("Đang quá bán")

    if pd.notna(macd) and pd.notna(macd_signal) and macd > macd_signal:
        notes.append("MACD ủng hộ xu hướng tăng")

    if bool(last["breakout_20"]):
        notes.append("Breakout 20 phiên")

    if bool(last["breakout_55"]):
        notes.append("Breakout 55 phiên")

    if pd.notna(volume_ratio) and volume_ratio >= 1.5:
        notes.append("Khối lượng tăng mạnh")

    if not notes:
        return "Trạng thái trung tính"

    return " · ".join(notes)


def trim_old_price_bars(cur, symbol):
    cur.execute(
        """
        delete from price_bars
        where symbol = %s
          and id not in (
            select id from (
              select id
              from price_bars
              where symbol = %s
              order by ts desc
              limit 140
            ) keep_rows
          )
        """,
        (symbol, symbol),
    )


def main():
    print("=== START UPDATE ===")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("select symbol from stocks order by symbol")
    symbols = [row[0] for row in cur.fetchall()]
    print("Danh sách mã:", symbols)

    for symbol in symbols:
        try:
            print(f"--- Đang xử lý {symbol} ---")

            quote = Quote(symbol=symbol, source="VCI")
            raw_df = quote.history(
                start="2025-01-01",
                end=datetime.now().strftime("%Y-%m-%d"),
                interval="1D",
            )

            print(f"{symbol} raw rows:", 0 if raw_df is None else len(raw_df))

            df = normalize_df(raw_df)
            print(f"{symbol} normalized rows:", len(df))

            if len(df) < 120:
                print(f"{symbol}: không đủ dữ liệu để tính đầy đủ MA100")
                continue

            recent_df = df.tail(140)

            for _, row in recent_df.iterrows():
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

            trim_old_price_bars(cur, symbol)

            df["ma20"] = df["close"].rolling(20).mean()
            df["ma50"] = df["close"].rolling(50).mean()
            df["ma100"] = df["close"].rolling(100).mean()
            df["rsi"] = calc_rsi(df["close"], 14)
            df["macd"], df["macd_signal"], df["macd_hist"] = calc_macd(df["close"])
            df["volume_ma20"] = df["volume"].rolling(20).mean()
            df["volume_ratio"] = df["volume"] / df["volume_ma20"]

            df["highest_20_prev"] = df["high"].rolling(20).max().shift(1)
            df["highest_55_prev"] = df["high"].rolling(55).max().shift(1)

            df["breakout_20"] = df["close"] > df["highest_20_prev"]
            df["breakout_55"] = df["close"] > df["highest_55_prev"]
            df["distance_ma20"] = ((df["close"] - df["ma20"]) / df["ma20"]) * 100

            last = df.iloc[-1]

            bullish_ma = bool(
                pd.notna(last["ma20"])
                and pd.notna(last["ma50"])
                and float(last["close"]) > float(last["ma20"]) > float(last["ma50"])
            )

            bullish_macd = bool(
                pd.notna(last["macd"])
                and pd.notna(last["macd_signal"])
                and float(last["macd"]) > float(last["macd_signal"])
            )

            overbought = bool(pd.notna(last["rsi"]) and float(last["rsi"]) >= 70)
            oversold = bool(pd.notna(last["rsi"]) and float(last["rsi"]) <= 30)
            breakout_20 = bool(last["breakout_20"]) if pd.notna(last["breakout_20"]) else False
            breakout_55 = bool(last["breakout_55"]) if pd.notna(last["breakout_55"]) else False

            price_action = str(detect_price_action(df.tail(5)))

            technical_score = 0
            momentum_score = 0
            breakout_score = 0

            if bullish_ma:
                technical_score += 25
            if (
                pd.notna(last["close"])
                and pd.notna(last["ma100"])
                and float(last["close"]) > float(last["ma100"])
            ):
                technical_score += 10
            if pd.notna(last["distance_ma20"]) and 0 <= float(last["distance_ma20"]) <= 8:
                technical_score += 10

            if bullish_macd:
                momentum_score += 15
            if pd.notna(last["rsi"]) and 50 <= float(last["rsi"]) <= 70:
                momentum_score += 15
            if pd.notna(last["macd_hist"]) and float(last["macd_hist"]) > 0:
                momentum_score += 10

            if breakout_20:
                breakout_score += 12
            if breakout_55:
                breakout_score += 18
            if pd.notna(last["volume_ratio"]) and float(last["volume_ratio"]) >= 1.5:
                breakout_score += 10

            total_score = technical_score + momentum_score + breakout_score
            expert_note = build_expert_note(last)

            cur.execute(
                """
                insert into stock_signals
                (symbol, ts, close, rsi, ma20, ma50, ma100, macd, macd_signal, macd_hist,
                 price_action, bullish_ma, bullish_macd, overbought, oversold,
                 volume_ma20, volume_ratio, breakout_20, breakout_55, distance_ma20,
                 technical_score, momentum_score, breakout_score, total_score, expert_note)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                  oversold = excluded.oversold,
                  volume_ma20 = excluded.volume_ma20,
                  volume_ratio = excluded.volume_ratio,
                  breakout_20 = excluded.breakout_20,
                  breakout_55 = excluded.breakout_55,
                  distance_ma20 = excluded.distance_ma20,
                  technical_score = excluded.technical_score,
                  momentum_score = excluded.momentum_score,
                  breakout_score = excluded.breakout_score,
                  total_score = excluded.total_score,
                  expert_note = excluded.expert_note
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
                    bool(bullish_ma),
                    bool(bullish_macd),
                    bool(overbought),
                    bool(oversold),
                    float(last["volume_ma20"]) if pd.notna(last["volume_ma20"]) else None,
                    float(last["volume_ratio"]) if pd.notna(last["volume_ratio"]) else None,
                    bool(breakout_20),
                    bool(breakout_55),
                    float(last["distance_ma20"]) if pd.notna(last["distance_ma20"]) else None,
                    float(technical_score),
                    float(momentum_score),
                    float(breakout_score),
                    float(total_score),
                    expert_note,
                ),
            )

            conn.commit()
            print(f"{symbol}: ghi stock_signals thành công")

        except Exception as e:
            conn.rollback()
            print(f"LỖI {symbol}: {e}")

    cur.close()
    conn.close()
    print("=== END UPDATE ===")


if __name__ == "__main__":
    main()
