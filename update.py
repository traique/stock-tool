import os
import math
import traceback
from datetime import datetime, timedelta

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from vnstock import Quote

DB_URL = os.environ["DB_URL"]

KEEP_PRICE_BARS_PER_SYMBOL = 160
MIN_REQUIRED_BARS = 120


def log(message: str) -> None:
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calc_macd(series: pd.Series):
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return macd, signal, hist


def to_python_number(value):
    if value is None:
        return None
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    try:
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    except Exception:
        return None


def normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return pd.DataFrame()

    work = df.copy()
    work.columns = [str(c).strip().lower() for c in work.columns]

    rename_candidates = {
        "time": "ts",
        "date": "ts",
        "datetime": "ts",
    }
    for old_col, new_col in rename_candidates.items():
        if old_col in work.columns and "ts" not in work.columns:
            work = work.rename(columns={old_col: new_col})

    required = ["ts", "open", "high", "low", "close", "volume"]
    missing = [col for col in required if col not in work.columns]
    if missing:
        raise ValueError(f"Thiếu cột bắt buộc: {', '.join(missing)}")

    work["ts"] = pd.to_datetime(work["ts"], errors="coerce")
    for col in ["open", "high", "low", "close", "volume"]:
        work[col] = pd.to_numeric(work[col], errors="coerce")

    work = work.dropna(subset=["ts", "open", "high", "low", "close", "volume"])
    work = work.sort_values("ts").drop_duplicates(subset=["ts"], keep="last")
    work = work.reset_index(drop=True)

    return work


def fetch_history(symbol: str) -> pd.DataFrame:
    q = Quote(symbol=symbol, source="VCI")

    end_date = datetime.now()
    start_date = end_date - timedelta(days=800)

    try:
        df = q.history(
            start=start_date.strftime("%Y-%m-%d"),
            end=end_date.strftime("%Y-%m-%d"),
            interval="1D",
        )
    except Exception as e:
        raise RuntimeError(f"Lỗi lấy lịch sử giá cho {symbol}: {e}")

    return normalize_df(df)


def build_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    work = df.copy()

    work["ma20"] = work["close"].rolling(20, min_periods=20).mean()
    work["ma50"] = work["close"].rolling(50, min_periods=50).mean()
    work["ma100"] = work["close"].rolling(100, min_periods=100).mean()

    work["volume_ma20"] = work["volume"].rolling(20, min_periods=20).mean()
    work["volume_ratio"] = work["volume"] / work["volume_ma20"].replace(0, pd.NA)

    work["rsi"] = calc_rsi(work["close"], 14)

    macd, macd_signal, macd_hist = calc_macd(work["close"])
    work["macd"] = macd
    work["macd_signal"] = macd_signal
    work["macd_hist"] = macd_hist

    work["highest_20_prev"] = work["high"].shift(1).rolling(20, min_periods=20).max()
    work["highest_55_prev"] = work["high"].shift(1).rolling(55, min_periods=55).max()

    work["breakout_20"] = work["close"] > work["highest_20_prev"]
    work["breakout_55"] = work["close"] > work["highest_55_prev"]

    work["bullish_ma"] = (
        (work["close"] > work["ma20"])
        & (work["ma20"] > work["ma50"])
        & (work["ma50"] > work["ma100"])
    )

    work["bullish_macd"] = (work["macd"] > work["macd_signal"]) & (work["macd"] > 0)

    work["overbought"] = work["rsi"] >= 70
    work["oversold"] = work["rsi"] <= 30

    work["distance_ma20"] = (
        (work["close"] - work["ma20"]) / work["ma20"].replace(0, pd.NA)
    ) * 100

    body = (work["close"] - work["open"]).abs()
    candle_range = (work["high"] - work["low"]).replace(0, pd.NA)
    body_ratio = body / candle_range

    work["price_action"] = "neutral"
    work.loc[
        (work["close"] > work["open"]) & (body_ratio >= 0.6),
        "price_action"
    ] = "bullish"
    work.loc[
        (work["close"] < work["open"]) & (body_ratio >= 0.6),
        "price_action"
    ] = "bearish"

    return work


def score_latest_row(row: pd.Series):
    technical_score = 0
    momentum_score = 0
    breakout_score = 0

    if bool(row.get("bullish_ma")):
        technical_score += 20
    if bool(row.get("bullish_macd")):
        technical_score += 15

    rsi = to_python_number(row.get("rsi"))
    volume_ratio = to_python_number(row.get("volume_ratio"))
    distance_ma20 = to_python_number(row.get("distance_ma20"))

    if rsi is not None:
        if 50 <= rsi <= 65:
            momentum_score += 15
        elif 65 < rsi < 75:
            momentum_score += 8
        elif rsi < 35:
            momentum_score += 5

    if volume_ratio is not None:
        if volume_ratio >= 1.8:
            momentum_score += 15
        elif volume_ratio >= 1.2:
            momentum_score += 8

    if bool(row.get("breakout_20")):
        breakout_score += 15
    if bool(row.get("breakout_55")):
        breakout_score += 25

    if distance_ma20 is not None:
        if 0 <= distance_ma20 <= 5:
            breakout_score += 10
        elif 5 < distance_ma20 <= 9:
            breakout_score += 5
        elif distance_ma20 < -3:
            breakout_score -= 5

    total_score = technical_score + momentum_score + breakout_score

    notes = []

    if bool(row.get("breakout_55")):
        notes.append("Breakout mạnh trên nền 55 phiên")
    elif bool(row.get("breakout_20")):
        notes.append("Có breakout ngắn hạn 20 phiên")

    if bool(row.get("bullish_ma")):
        notes.append("Cấu trúc MA tích cực")

    if bool(row.get("bullish_macd")):
        notes.append("MACD ủng hộ xu hướng tăng")

    if rsi is not None:
        if rsi >= 70:
            notes.append("RSI cao, cần tránh mua đuổi")
        elif rsi <= 35:
            notes.append("RSI thấp, cần quan sát hồi phục")

    if volume_ratio is not None and volume_ratio >= 1.5:
        notes.append("Thanh khoản tăng so với trung bình 20 phiên")

    expert_note = ". ".join(notes) if notes else "Tín hiệu trung tính, cần quan sát thêm"

    return technical_score, momentum_score, breakout_score, total_score, expert_note


def get_symbols(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM stocks ORDER BY symbol ASC")
        rows = cur.fetchall()
    return [str(r[0]).strip().upper() for r in rows if r and r[0]]


def upsert_price_bars(conn, symbol: str, df: pd.DataFrame) -> None:
    records = []
    for _, row in df.iterrows():
        records.append(
            (
                symbol,
                row["ts"].to_pydatetime(),
                to_python_number(row["open"]),
                to_python_number(row["high"]),
                to_python_number(row["low"]),
                to_python_number(row["close"]),
                to_python_number(row["volume"]),
            )
        )

    if not records:
        return

    sql = """
    INSERT INTO price_bars (symbol, ts, open, high, low, close, volume)
    VALUES %s
    ON CONFLICT (symbol, ts) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume
    """

    with conn.cursor() as cur:
        execute_values(cur, sql, records, page_size=500)


def trim_old_price_bars(conn, symbol: str, keep_rows: int = KEEP_PRICE_BARS_PER_SYMBOL) -> None:
    sql = """
    DELETE FROM price_bars
    WHERE symbol = %s
      AND ts NOT IN (
        SELECT ts
        FROM price_bars
        WHERE symbol = %s
        ORDER BY ts DESC
        LIMIT %s
      )
    """
    with conn.cursor() as cur:
        cur.execute(sql, (symbol, symbol, keep_rows))


def upsert_latest_signal(conn, symbol: str, latest: pd.Series) -> None:
    technical_score, momentum_score, breakout_score, total_score, expert_note = score_latest_row(latest)

    sql = """
    INSERT INTO stock_signals (
      symbol, ts, close, rsi, ma20, ma50, ma100,
      macd, macd_signal, volume_ma20, volume_ratio, distance_ma20,
      bullish_ma, bullish_macd, breakout_20, breakout_55,
      overbought, oversold, price_action,
      technical_score, momentum_score, breakout_score, total_score,
      expert_note, created_at
    )
    VALUES (
      %s, %s, %s, %s, %s, %s, %s,
      %s, %s, %s, %s, %s,
      %s, %s, %s, %s,
      %s, %s, %s,
      %s, %s, %s, %s,
      %s, NOW()
    )
    ON CONFLICT (symbol, ts) DO UPDATE SET
      close = EXCLUDED.close,
      rsi = EXCLUDED.rsi,
      ma20 = EXCLUDED.ma20,
      ma50 = EXCLUDED.ma50,
      ma100 = EXCLUDED.ma100,
      macd = EXCLUDED.macd,
      macd_signal = EXCLUDED.macd_signal,
      volume_ma20 = EXCLUDED.volume_ma20,
      volume_ratio = EXCLUDED.volume_ratio,
      distance_ma20 = EXCLUDED.distance_ma20,
      bullish_ma = EXCLUDED.bullish_ma,
      bullish_macd = EXCLUDED.bullish_macd,
      breakout_20 = EXCLUDED.breakout_20,
      breakout_55 = EXCLUDED.breakout_55,
      overbought = EXCLUDED.overbought,
      oversold = EXCLUDED.oversold,
      price_action = EXCLUDED.price_action,
      technical_score = EXCLUDED.technical_score,
      momentum_score = EXCLUDED.momentum_score,
      breakout_score = EXCLUDED.breakout_score,
      total_score = EXCLUDED.total_score,
      expert_note = EXCLUDED.expert_note,
      created_at = NOW()
    """

    with conn.cursor() as cur:
        cur.execute(
            sql,
            (
                symbol,
                latest["ts"].to_pydatetime(),
                to_python_number(latest.get("close")),
                to_python_number(latest.get("rsi")),
                to_python_number(latest.get("ma20")),
                to_python_number(latest.get("ma50")),
                to_python_number(latest.get("ma100")),
                to_python_number(latest.get("macd")),
                to_python_number(latest.get("macd_signal")),
                to_python_number(latest.get("volume_ma20")),
                to_python_number(latest.get("volume_ratio")),
                to_python_number(latest.get("distance_ma20")),
                bool(latest.get("bullish_ma")) if pd.notna(latest.get("bullish_ma")) else False,
                bool(latest.get("bullish_macd")) if pd.notna(latest.get("bullish_macd")) else False,
                bool(latest.get("breakout_20")) if pd.notna(latest.get("breakout_20")) else False,
                bool(latest.get("breakout_55")) if pd.notna(latest.get("breakout_55")) else False,
                bool(latest.get("overbought")) if pd.notna(latest.get("overbought")) else False,
                bool(latest.get("oversold")) if pd.notna(latest.get("oversold")) else False,
                str(latest.get("price_action") or "neutral"),
                technical_score,
                momentum_score,
                breakout_score,
                total_score,
                expert_note,
            ),
        )


def process_symbol(conn, symbol: str) -> dict:
    try:
        log(f"Đang xử lý {symbol}")
        raw_df = fetch_history(symbol)

        if raw_df.empty or len(raw_df) < MIN_REQUIRED_BARS:
            return {"symbol": symbol, "ok": False, "reason": "Không đủ dữ liệu lịch sử"}

        feature_df = build_feature_frame(raw_df)
        latest = feature_df.iloc[-1]

        upsert_price_bars(conn, symbol, feature_df.tail(KEEP_PRICE_BARS_PER_SYMBOL))
        trim_old_price_bars(conn, symbol)
        upsert_latest_signal(conn, symbol, latest)

        _, _, _, total_score, _ = score_latest_row(latest)

        return {
            "symbol": symbol,
            "ok": True,
            "ts": str(latest["ts"]),
            "close": to_python_number(latest.get("close")),
            "score": total_score,
        }
    except Exception as exc:
        return {
            "symbol": symbol,
            "ok": False,
            "reason": str(exc),
            "trace": traceback.format_exc(limit=5),
        }


def main():
    log("Bắt đầu update giá và tín hiệu")

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    success = 0
    failed = 0

    try:
        symbols = get_symbols(conn)
        log(f"Tổng số mã cần xử lý: {len(symbols)}")

        if not symbols:
            log("Không có mã nào trong bảng stocks")
            return

        for symbol in symbols:
            result = process_symbol(conn, symbol)

            if result["ok"]:
                conn.commit()
                success += 1
                log(
                    f"OK {result['symbol']} | ts={result['ts']} | close={result['close']} | score={result['score']}"
                )
            else:
                conn.rollback()
                failed += 1
                log(f"FAIL {result['symbol']} | {result['reason']}")
                if result.get("trace"):
                    print(result["trace"], flush=True)

        log(f"Hoàn tất. Thành công={success}, lỗi={failed}")

        if success == 0 and failed > 0:
            raise RuntimeError("Toàn bộ job thất bại")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
