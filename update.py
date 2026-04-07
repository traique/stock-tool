import os
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from vnstock import Quote

DB_URL = os.environ["DB_URL"]

TIMEFRAME = "1D"
MIN_BARS_REQUIRED = 120
KEEP_BARS = 150
INDICATOR_LOOKBACK_BARS = 150
SEED_LOOKBACK_DAYS = 420
INCREMENTAL_OVERLAP_DAYS = 3
FETCH_WORKERS = 4
COMMIT_BATCH_SIZE = 5

VN_TZ = timezone(timedelta(hours=7))


def log(message):
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def is_market_window(now_vn=None):
    now_vn = now_vn or datetime.now(VN_TZ)

    # Monday=0 ... Sunday=6
    if now_vn.weekday() >= 5:
        return False

    current_hhmm = now_vn.hour * 100 + now_vn.minute

    morning = 900 <= current_hhmm <= 1130
    afternoon = 1300 <= current_hhmm <= 1500
    return morning or afternoon


def calc_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()

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


def calc_atr(df, period=14):
    high_low = df["high"] - df["low"]
    high_close = (df["high"] - df["close"].shift(1)).abs()
    low_close = (df["low"] - df["close"].shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def normalize_df(df):
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])

    work = df.copy()
    work.columns = [str(c).lower().strip() for c in work.columns]

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

    work["ts"] = pd.to_datetime(work["ts"], errors="coerce")
    for col in ["open", "high", "low", "close", "volume"]:
        work[col] = pd.to_numeric(work[col], errors="coerce")

    work = work.dropna(subset=["ts", "open", "high", "low", "close", "volume"])
    work = work.sort_values("ts").drop_duplicates(subset=["ts"], keep="last").reset_index(drop=True)
    return work


def get_latest_db_ts(cur, symbol):
    cur.execute(
        """
        select max(ts)
        from price_bars
        where symbol = %s and timeframe = %s
        """,
        (symbol, TIMEFRAME),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] is not None else None


def load_recent_bars_from_db(cur, symbol, limit=INDICATOR_LOOKBACK_BARS):
    cur.execute(
        """
        select ts, open, high, low, close, volume
        from (
          select ts, open, high, low, close, volume
          from price_bars
          where symbol = %s and timeframe = %s
          order by ts desc
          limit %s
        ) t
        order by ts asc
        """,
        (symbol, TIMEFRAME, limit),
    )
    rows = cur.fetchall()
    if not rows:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])

    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["ts", "open", "high", "low", "close", "volume"])
    df = df.sort_values("ts").drop_duplicates(subset=["ts"], keep="last").reset_index(drop=True)
    return df


def merge_price_frames(old_df, new_df):
    frames = []
    if old_df is not None and len(old_df) > 0:
        frames.append(old_df[["ts", "open", "high", "low", "close", "volume"]].copy())
    if new_df is not None and len(new_df) > 0:
        frames.append(new_df[["ts", "open", "high", "low", "close", "volume"]].copy())

    if not frames:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])

    merged = pd.concat(frames, ignore_index=True)
    merged["ts"] = pd.to_datetime(merged["ts"], errors="coerce")
    for col in ["open", "high", "low", "close", "volume"]:
        merged[col] = pd.to_numeric(merged[col], errors="coerce")

    merged = merged.dropna(subset=["ts", "open", "high", "low", "close", "volume"])
    merged = merged.sort_values("ts").drop_duplicates(subset=["ts"], keep="last").reset_index(drop=True)
    return merged


def determine_fetch_start(latest_db_ts):
    today = datetime.now().date()
    if latest_db_ts is None:
        return (today - timedelta(days=SEED_LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    latest_date = pd.to_datetime(latest_db_ts).date()
    start_date = latest_date - timedelta(days=INCREMENTAL_OVERLAP_DAYS)
    return start_date.strftime("%Y-%m-%d")


def fetch_history(symbol, start_date):
    quote = Quote(symbol=symbol, source="VCI")
    raw_df = quote.history(
        start=start_date,
        end=datetime.now().strftime("%Y-%m-%d"),
        interval=TIMEFRAME,
    )
    return normalize_df(raw_df)


def fetch_remote_history_task(symbol, fetch_start):
    fetched_df = fetch_history(symbol, fetch_start)
    return symbol, fetched_df


def upsert_price_bars(cur, symbol, df, source="vnstock_incremental"):
    if df is None or len(df) == 0:
        return 0

    rows = []
    for _, row in df.iterrows():
        rows.append(
            (
                symbol,
                TIMEFRAME,
                row["ts"].to_pydatetime(),
                float(row["open"]) if pd.notna(row["open"]) else None,
                float(row["high"]) if pd.notna(row["high"]) else None,
                float(row["low"]) if pd.notna(row["low"]) else None,
                float(row["close"]) if pd.notna(row["close"]) else None,
                float(row["volume"]) if pd.notna(row["volume"]) else None,
                source,
            )
        )

    sql = """
        insert into price_bars
        (symbol, timeframe, ts, open, high, low, close, volume, source)
        values %s
        on conflict (symbol, timeframe, ts) do update set
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume,
          source = excluded.source
    """

    execute_values(cur, sql, rows, page_size=200)
    return len(rows)


def trim_old_price_bars(cur, symbol):
    cur.execute(
        """
        delete from price_bars
        where symbol = %s
          and timeframe = %s
          and id not in (
            select id from (
              select id
              from price_bars
              where symbol = %s and timeframe = %s
              order by ts desc
              limit %s
            ) keep_rows
          )
        """,
        (symbol, TIMEFRAME, symbol, TIMEFRAME, KEEP_BARS),
    )


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
    candle_range = float(last["high"]) - float(last["low"]) if pd.notna(last["high"]) and pd.notna(last["low"]) else 0
    lower_wick = min(float(last["open"]), float(last["close"])) - float(last["low"]) if pd.notna(last["low"]) else 0
    upper_wick = float(last["high"]) - max(float(last["open"]), float(last["close"])) if pd.notna(last["high"]) else 0

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

    if last["close"] > last["ma20"] > last["ma50"]:
        notes.append("Giá nằm trên MA20 và MA50")
    elif last["close"] > last["ma20"]:
        notes.append("Giá nằm trên MA20")
    else:
        notes.append("Giá dưới MA20")

    if pd.notna(last["macd"]) and pd.notna(last["macd_signal"]):
        if last["macd"] > last["macd_signal"]:
            notes.append("MACD đang bullish")
        else:
            notes.append("MACD đang bearish")

    if pd.notna(last["rsi"]):
        if 52 <= last["rsi"] <= 68:
            notes.append("Động lượng tích cực")
        elif last["rsi"] > 72:
            notes.append("Động lượng cao")
        elif last["rsi"] < 38:
            notes.append("Động lượng yếu")

    if bool(last["breakout_20"]):
        notes.append("Vượt đỉnh 20 phiên")

    if pd.notna(last["volume_ratio"]) and last["volume_ratio"] >= 1.3:
        notes.append("Khối lượng tăng tốt")

    return " · ".join(notes) if notes else "Trạng thái trung tính"


def detect_setup_type(last):
    if bool(last["breakout_20"]) and float(last["close"]) > float(last["ma20"]):
        return "TREND_BREAKOUT"

    if (
        pd.notna(last["distance_ma20"])
        and -2.0 <= float(last["distance_ma20"]) <= 2.5
        and pd.notna(last["ma20"])
        and pd.notna(last["ma50"])
        and float(last["ma20"]) >= float(last["ma50"])
        and float(last["close"]) >= float(last["ma20"])
    ):
        return "PULLBACK_MA20"

    if (
        pd.notna(last["ma20"])
        and pd.notna(last["ma50"])
        and float(last["close"]) > float(last["ma20"]) > float(last["ma50"])
    ):
        return "TREND_CONTINUATION"

    return "NONE"


def build_trade_plan(df):
    last = df.iloc[-1]
    recent_high_20 = float(df.tail(20)["high"].max())
    recent_low_5 = float(df.tail(5)["low"].min())
    recent_low_10 = float(df.tail(10)["low"].min())
    atr = float(last["atr"]) if pd.notna(last["atr"]) else None
    close = float(last["close"])
    ma20 = float(last["ma20"]) if pd.notna(last["ma20"]) else None

    setup_type = detect_setup_type(last)

    entry_price = close
    entry_zone_low = None
    entry_zone_high = None
    stop_loss = None
    tp1 = None
    tp2 = None
    trailing_stop = None
    rr = None
    position_size_pct = 0
    signal_action = "WATCH"
    signal_strength = "WEAK"
    confidence_score = 50

    if setup_type == "TREND_BREAKOUT":
        entry_zone_low = round(close * 0.995, 2)
        entry_zone_high = round(close * 1.012, 2)

        base_stop = min(recent_low_5, ma20) if ma20 is not None else recent_low_5
        stop_loss = round(base_stop - (atr * 0.35 if atr is not None else close * 0.012), 2)

        risk = entry_price - stop_loss
        if risk > 0:
            tp1 = round(entry_price + risk * 1.5, 2)
            tp2 = round(entry_price + risk * 2.4, 2)
            rr = round((tp2 - entry_price) / risk, 2)
            trailing_stop = round(max(stop_loss, entry_price - risk * 0.8), 2)

        strong = (
            pd.notna(last["volume_ratio"]) and float(last["volume_ratio"]) >= 1.3
            and pd.notna(last["rsi"]) and 55 <= float(last["rsi"]) <= 72
            and pd.notna(last["macd"]) and pd.notna(last["macd_signal"])
            and float(last["macd"]) > float(last["macd_signal"])
            and pd.notna(last["macd_hist"]) and float(last["macd_hist"]) > 0
        )

        signal_action = "BUY"
        signal_strength = "STRONG" if strong else "MEDIUM"
        position_size_pct = 18 if strong else 10
        confidence_score = 86 if strong else 75

    elif setup_type == "PULLBACK_MA20":
        if ma20 is not None:
            entry_zone_low = round(ma20 * 0.995, 2)
            entry_zone_high = round(ma20 * 1.01, 2)
            entry_price = round((entry_zone_low + entry_zone_high) / 2, 2)

        stop_loss = round(recent_low_10 - (atr * 0.25 if atr is not None else close * 0.01), 2)
        risk = entry_price - stop_loss
        if risk > 0:
            tp1 = round(recent_high_20, 2)
            tp2 = round(max(recent_high_20 * 1.05, entry_price + risk * 2.0), 2)
            rr = round((tp2 - entry_price) / risk, 2)
            trailing_stop = round(max(stop_loss, recent_low_5), 2)

        signal_action = "BUY" if rr is not None and rr >= 1.6 else "WATCH"
        signal_strength = "MEDIUM"
        position_size_pct = 10 if signal_action == "BUY" else 0
        confidence_score = 73 if signal_action == "BUY" else 62

    elif setup_type == "TREND_CONTINUATION":
        entry_zone_low = round(close * 0.99, 2)
        entry_zone_high = round(close * 1.01, 2)
        stop_loss = round(recent_low_5 * 0.99, 2)
        risk = entry_price - stop_loss
        if risk > 0:
            tp1 = round(entry_price + risk * 1.2, 2)
            tp2 = round(entry_price + risk * 2.0, 2)
            rr = round((tp2 - entry_price) / risk, 2)
            trailing_stop = round(recent_low_5, 2)

        signal_action = "HOLD"
        signal_strength = "MEDIUM"
        position_size_pct = 8
        confidence_score = 67

    if pd.notna(last["rsi"]) and float(last["rsi"]) >= 75 and pd.notna(last["distance_ma20"]) and float(last["distance_ma20"]) >= 8:
        signal_action = "TAKE_PROFIT"
        signal_strength = "STRONG"
        confidence_score = 82
        position_size_pct = 0

    if (
        pd.notna(last["ma20"])
        and float(last["close"]) < float(last["ma20"])
        and pd.notna(last["macd"]) and pd.notna(last["macd_signal"])
        and float(last["macd"]) < float(last["macd_signal"])
        and pd.notna(last["volume_ratio"]) and float(last["volume_ratio"]) >= 1.1
    ):
        signal_action = "SELL"
        signal_strength = "STRONG"
        confidence_score = 84
        position_size_pct = 0

    if stop_loss is not None and close < stop_loss:
        signal_action = "CUT_LOSS"
        signal_strength = "STRONG"
        confidence_score = 90
        position_size_pct = 0

    return {
        "setup_type": setup_type,
        "signal_action": signal_action,
        "signal_strength": signal_strength,
        "entry_price": round(entry_price, 2) if entry_price is not None else None,
        "entry_zone_low": entry_zone_low,
        "entry_zone_high": entry_zone_high,
        "stop_loss": stop_loss,
        "take_profit_1": tp1,
        "take_profit_2": tp2,
        "trailing_stop": trailing_stop,
        "risk_reward_ratio": rr,
        "position_size_pct": position_size_pct,
        "confidence_score": confidence_score,
    }


def build_strategy_note(last, plan):
    action = plan["signal_action"]
    setup = plan["setup_type"]

    if action == "BUY" and setup == "TREND_BREAKOUT":
        return (
            f"Tín hiệu theo xu hướng đang xác nhận. Có thể mua quanh {plan['entry_zone_low']} - {plan['entry_zone_high']}, "
            f"cắt lỗ {plan['stop_loss']}, mục tiêu TP1 {plan['take_profit_1']} và TP2 {plan['take_profit_2']}."
        )

    if action == "BUY" and setup == "PULLBACK_MA20":
        return (
            f"Cổ phiếu đang hồi về MA20 nhưng chưa gãy xu hướng. Có thể canh mua quanh {plan['entry_zone_low']} - {plan['entry_zone_high']}, "
            f"cắt lỗ {plan['stop_loss']}."
        )

    if action == "HOLD":
        return f"Xu hướng vẫn tích cực. Ưu tiên nắm giữ và theo dõi trailing stop tại {plan['trailing_stop']}."

    if action == "TAKE_PROFIT":
        return "Cổ phiếu tăng nóng và đã mở rộng khá xa khỏi MA20. Ưu tiên chốt lời từng phần."

    if action == "SELL":
        return "Giá đã đánh mất hỗ trợ MA20 và MACD suy yếu. Ưu tiên hạ tỷ trọng."

    if action == "CUT_LOSS":
        return f"Giá đã vi phạm vùng stop loss {plan['stop_loss']}. Nên cắt lỗ theo kỷ luật."

    return "Tín hiệu hiện chưa đủ mạnh để giải ngân lớn. Ưu tiên quan sát thêm."


def upsert_system_status(cur, latest_market_ts):
    cur.execute(
        """
        insert into system_status (job_name, last_run_at, last_success_at, last_market_ts, updated_at)
        values (%s, now(), now(), %s, now())
        on conflict (job_name) do update set
          last_run_at = excluded.last_run_at,
          last_success_at = excluded.last_success_at,
          last_market_ts = excluded.last_market_ts,
          updated_at = now()
        """,
        ("price_update", latest_market_ts),
    )


def main():
    now_vn = datetime.now(VN_TZ)
    if not is_market_window(now_vn):
        log(f"Ngoài giờ giao dịch GMT+7 ({now_vn.isoformat()}). Bỏ qua update.")
        return

    log(f"Bắt đầu update giá và tín hiệu | now_vn={now_vn.isoformat()}")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    success_count = 0
    latest_market_ts = None
    processed_since_commit = 0

    try:
        cur.execute("select symbol from stocks order by symbol")
        symbols = [str(row[0]).strip().upper() for row in cur.fetchall() if row and row[0]]
        log(f"Tổng số mã watchlist cần xử lý: {len(symbols)}")

        if not symbols:
            log("Watchlist đang rỗng. Kết thúc.")
            return

        prepared = []
        for symbol in symbols:
            latest_db_ts = get_latest_db_ts(cur, symbol)
            fetch_start = determine_fetch_start(latest_db_ts)
            db_recent_df = load_recent_bars_from_db(cur, symbol, limit=INDICATOR_LOOKBACK_BARS)
            prepared.append(
                {
                    "symbol": symbol,
                    "latest_db_ts": latest_db_ts,
                    "fetch_start": fetch_start,
                    "db_recent_df": db_recent_df,
                }
            )

        fetched_map = {}
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
            future_map = {
                executor.submit(fetch_remote_history_task, item["symbol"], item["fetch_start"]): item["symbol"]
                for item in prepared
            }

            for future in as_completed(future_map):
                symbol = future_map[future]
                try:
                    _, fetched_df = future.result()
                    fetched_map[symbol] = fetched_df
                    log(f"FETCH OK {symbol} | rows={len(fetched_df)}")
                except Exception as e:
                    log(f"FAIL FETCH {symbol} | {e}")
                    fetched_map[symbol] = pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])

        for item in prepared:
            symbol = item["symbol"]

            try:
                fetched_df = fetched_map.get(symbol)
                db_recent_df = item["db_recent_df"]

                working_df = merge_price_frames(db_recent_df, fetched_df)
                working_df = working_df.tail(INDICATOR_LOOKBACK_BARS).reset_index(drop=True)

                if len(working_df) < MIN_BARS_REQUIRED:
                    log(f"FAIL {symbol} | Không đủ dữ liệu sau khi merge")
                    continue

                upserted_rows = upsert_price_bars(cur, symbol, fetched_df)
                trim_old_price_bars(cur, symbol)

                df = working_df.copy()

                df["ma20"] = df["close"].rolling(20).mean()
                df["ma50"] = df["close"].rolling(50).mean()
                df["ma100"] = df["close"].rolling(100).mean()
                df["rsi"] = calc_rsi(df["close"], 14)
                df["macd"], df["macd_signal"], df["macd_hist"] = calc_macd(df["close"])
                df["volume_ma20"] = df["volume"].rolling(20).mean()
                df["volume_ratio"] = df["volume"] / df["volume_ma20"].replace(0, pd.NA)
                df["atr"] = calc_atr(df, 14)

                df["highest_20_prev"] = df["high"].rolling(20).max().shift(1)
                df["breakout_20"] = df["close"] > df["highest_20_prev"]
                df["distance_ma20"] = ((df["close"] - df["ma20"]) / df["ma20"].replace(0, pd.NA)) * 100

                last = df.iloc[-1]
                prev = df.iloc[-2] if len(df) >= 2 else last

                bullish_ma = bool(
                    pd.notna(last["ma20"])
                    and pd.notna(last["ma50"])
                    and float(last["close"]) > float(last["ma20"]) >= float(last["ma50"])
                )

                bullish_macd = bool(
                    pd.notna(last["macd"])
                    and pd.notna(last["macd_signal"])
                    and float(last["macd"]) > float(last["macd_signal"])
                )

                macd_cross_up = bool(
                    pd.notna(prev["macd"]) and pd.notna(prev["macd_signal"])
                    and pd.notna(last["macd"]) and pd.notna(last["macd_signal"])
                    and float(prev["macd"]) <= float(prev["macd_signal"])
                    and float(last["macd"]) > float(last["macd_signal"])
                )

                macd_cross_down = bool(
                    pd.notna(prev["macd"]) and pd.notna(prev["macd_signal"])
                    and pd.notna(last["macd"]) and pd.notna(last["macd_signal"])
                    and float(prev["macd"]) >= float(prev["macd_signal"])
                    and float(last["macd"]) < float(last["macd_signal"])
                )

                overbought = bool(pd.notna(last["rsi"]) and float(last["rsi"]) >= 70)
                oversold = bool(pd.notna(last["rsi"]) and float(last["rsi"]) <= 30)
                breakout_20 = bool(last["breakout_20"]) if pd.notna(last["breakout_20"]) else False
                price_action = str(detect_price_action(df.tail(5)))

                technical_score = 0
                momentum_score = 0
                breakout_score = 0

                if bullish_ma:
                    technical_score += 35
                if pd.notna(last["ma100"]) and float(last["close"]) > float(last["ma100"]):
                    technical_score += 10
                if pd.notna(last["distance_ma20"]) and 0 <= float(last["distance_ma20"]) <= 6:
                    technical_score += 10

                if bullish_macd:
                    momentum_score += 20
                if macd_cross_up:
                    momentum_score += 12
                if macd_cross_down:
                    momentum_score -= 10
                if pd.notna(last["rsi"]) and 52 <= float(last["rsi"]) <= 68:
                    momentum_score += 14
                elif pd.notna(last["rsi"]) and float(last["rsi"]) > 74:
                    momentum_score -= 6
                if pd.notna(last["macd_hist"]) and float(last["macd_hist"]) > 0:
                    momentum_score += 8

                if breakout_20:
                    breakout_score += 15
                if pd.notna(last["volume_ratio"]) and float(last["volume_ratio"]) >= 1.3:
                    breakout_score += 10

                total_score = technical_score + momentum_score + breakout_score

                expert_note = build_expert_note(last)
                trade_plan = build_trade_plan(df)
                expert_strategy_note = build_strategy_note(last, trade_plan)

                cur.execute(
                    """
                    insert into stock_signals
                    (symbol, ts, close, rsi, ma20, ma50, ma100, macd, macd_signal, macd_hist,
                     price_action, bullish_ma, bullish_macd, overbought, oversold,
                     volume_ma20, volume_ratio, breakout_20, breakout_55, distance_ma20,
                     technical_score, momentum_score, breakout_score, total_score, expert_note,
                     signal_action, signal_strength, setup_type, entry_price, entry_zone_low, entry_zone_high,
                     stop_loss, take_profit_1, take_profit_2, trailing_stop, risk_reward_ratio,
                     position_size_pct, confidence_score, expert_strategy_note)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                      expert_note = excluded.expert_note,
                      signal_action = excluded.signal_action,
                      signal_strength = excluded.signal_strength,
                      setup_type = excluded.setup_type,
                      entry_price = excluded.entry_price,
                      entry_zone_low = excluded.entry_zone_low,
                      entry_zone_high = excluded.entry_zone_high,
                      stop_loss = excluded.stop_loss,
                      take_profit_1 = excluded.take_profit_1,
                      take_profit_2 = excluded.take_profit_2,
                      trailing_stop = excluded.trailing_stop,
                      risk_reward_ratio = excluded.risk_reward_ratio,
                      position_size_pct = excluded.position_size_pct,
                      confidence_score = excluded.confidence_score,
                      expert_strategy_note = excluded.expert_strategy_note
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
                        False,
                        float(last["distance_ma20"]) if pd.notna(last["distance_ma20"]) else None,
                        float(technical_score),
                        float(momentum_score),
                        float(breakout_score),
                        float(total_score),
                        expert_note,
                        trade_plan["signal_action"],
                        trade_plan["signal_strength"],
                        trade_plan["setup_type"],
                        trade_plan["entry_price"],
                        trade_plan["entry_zone_low"],
                        trade_plan["entry_zone_high"],
                        trade_plan["stop_loss"],
                        trade_plan["take_profit_1"],
                        trade_plan["take_profit_2"],
                        trade_plan["trailing_stop"],
                        trade_plan["risk_reward_ratio"],
                        trade_plan["position_size_pct"],
                        trade_plan["confidence_score"],
                        expert_strategy_note,
                    ),
                )

                market_ts = last["ts"].to_pydatetime()
                if latest_market_ts is None or market_ts > latest_market_ts:
                    latest_market_ts = market_ts

                success_count += 1
                processed_since_commit += 1

                if processed_since_commit >= COMMIT_BATCH_SIZE:
                    conn.commit()
                    processed_since_commit = 0

                log(
                    f"OK {symbol} | upserted={upserted_rows} | "
                    f"action={trade_plan['signal_action']} | score={total_score}"
                )

            except Exception as e:
                conn.rollback()
                processed_since_commit = 0
                log(f"FAIL {symbol} | {e}")

        if processed_since_commit > 0:
            conn.commit()

        if success_count > 0:
            upsert_system_status(cur, latest_market_ts)
            conn.commit()
            log("Đã cập nhật system_status thành công")

    finally:
        cur.close()
        conn.close()
        log("Kết thúc update")


if __name__ == "__main__":
    main()
