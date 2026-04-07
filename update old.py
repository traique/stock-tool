import os
from datetime import datetime

import pandas as pd
import psycopg2
from vnstock import Quote

DB_URL = os.environ["DB_URL"]


def log(message):
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


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


def calc_atr(df, period=14):
    high_low = df["high"] - df["low"]
    high_close = (df["high"] - df["close"].shift(1)).abs()
    low_close = (df["low"] - df["close"].shift(1)).abs()

    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()
    return atr


def normalize_df(df):
    if df is None or len(df) == 0:
        return pd.DataFrame()

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


def fetch_history(symbol):
    quote = Quote(symbol=symbol, source="VCI")
    raw_df = quote.history(
        start="2025-01-01",
        end=datetime.now().strftime("%Y-%m-%d"),
        interval="1D",
    )
    return normalize_df(raw_df)


def build_expert_note(last):
    notes = []

    if last["close"] > last["ma20"] > last["ma50"] > last["ma100"]:
        notes.append("Xu hướng tăng khỏe")
    elif last["close"] > last["ma20"]:
        notes.append("Giá nằm trên MA20")
    else:
        notes.append("Xu hướng chưa mạnh")

    if pd.notna(last["rsi"]):
        if 50 <= last["rsi"] <= 70:
            notes.append("Động lượng tích cực")
        elif last["rsi"] > 70:
            notes.append("Đang quá mua")
        elif last["rsi"] < 30:
            notes.append("Đang quá bán")

    if pd.notna(last["macd"]) and pd.notna(last["macd_signal"]) and last["macd"] > last["macd_signal"]:
        notes.append("MACD ủng hộ xu hướng tăng")

    if bool(last["breakout_20"]):
        notes.append("Breakout 20 phiên")

    if bool(last["breakout_55"]):
        notes.append("Breakout 55 phiên")

    if pd.notna(last["volume_ratio"]) and last["volume_ratio"] >= 1.5:
        notes.append("Khối lượng tăng mạnh")

    if not notes:
        return "Trạng thái trung tính"

    return " · ".join(notes)


def detect_setup_type(last):
    if bool(last["breakout_55"]):
        return "BREAKOUT_55"
    if bool(last["breakout_20"]):
        return "BREAKOUT_20"

    if (
        pd.notna(last["distance_ma20"])
        and -2.0 <= float(last["distance_ma20"]) <= 2.0
        and pd.notna(last["ma20"])
        and pd.notna(last["ma50"])
        and float(last["ma20"]) > float(last["ma50"])
        and float(last["close"]) > float(last["ma50"])
    ):
        return "PULLBACK_MA20"

    if (
        pd.notna(last["ma20"])
        and pd.notna(last["ma50"])
        and pd.notna(last["ma100"])
        and float(last["close"]) > float(last["ma20"]) > float(last["ma50"]) > float(last["ma100"])
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

    if setup_type in ["BREAKOUT_55", "BREAKOUT_20"]:
        entry_price = close
        entry_zone_low = round(close * 0.995, 2)
        entry_zone_high = round(close * 1.015, 2)

        base_stop = recent_low_5
        if ma20 is not None:
            base_stop = min(base_stop, ma20)

        if atr is not None:
            stop_loss = round(base_stop - atr * 0.35, 2)
        else:
            stop_loss = round(base_stop * 0.985, 2)

        risk = entry_price - stop_loss
        if risk > 0:
            tp1 = round(entry_price + risk * 1.5, 2)
            tp2 = round(entry_price + risk * 2.5, 2)
            rr = round((tp2 - entry_price) / risk, 2)
            trailing_stop = round(max(stop_loss, entry_price - risk * 0.8), 2)

        strong_breakout = (
            pd.notna(last["volume_ratio"]) and float(last["volume_ratio"]) >= 1.3
            and pd.notna(last["rsi"]) and 55 <= float(last["rsi"]) <= 72
            and pd.notna(last["macd"]) and pd.notna(last["macd_signal"]) and float(last["macd"]) > float(last["macd_signal"])
        )

        if strong_breakout and rr is not None and rr >= 2:
            signal_action = "BUY"
            signal_strength = "STRONG"
            position_size_pct = 20
            confidence_score = 85
        else:
            signal_action = "BUY"
            signal_strength = "MEDIUM"
            position_size_pct = 12
            confidence_score = 74

    elif setup_type == "PULLBACK_MA20":
        if ma20 is not None:
            entry_zone_low = round(ma20 * 0.995, 2)
            entry_zone_high = round(ma20 * 1.01, 2)
            entry_price = round((entry_zone_low + entry_zone_high) / 2, 2)

        base_stop = recent_low_10
        if atr is not None:
            stop_loss = round(base_stop - atr * 0.25, 2)
        else:
            stop_loss = round(base_stop * 0.985, 2)

        risk = entry_price - stop_loss
        target = recent_high_20
        if risk > 0:
            tp1 = round(target, 2)
            tp2 = round(max(target * 1.06, entry_price + risk * 2.0), 2)
            rr = round((tp2 - entry_price) / risk, 2)
            trailing_stop = round(max(stop_loss, recent_low_5), 2)

        if rr is not None and rr >= 1.8:
            signal_action = "BUY"
            signal_strength = "MEDIUM"
            position_size_pct = 10
            confidence_score = 72
        else:
            signal_action = "WATCH"
            signal_strength = "MEDIUM"
            position_size_pct = 0
            confidence_score = 62

    elif setup_type == "TREND_CONTINUATION":
        entry_price = close
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
        confidence_score = 68

    # Tín hiệu chốt lời / bán
    if pd.notna(last["rsi"]) and float(last["rsi"]) >= 75 and pd.notna(last["distance_ma20"]) and float(last["distance_ma20"]) >= 8:
        signal_action = "TAKE_PROFIT"
        signal_strength = "STRONG"
        confidence_score = 82
        position_size_pct = 0

    if (
        pd.notna(last["ma20"])
        and float(last["close"]) < float(last["ma20"])
        and pd.notna(last["macd"])
        and pd.notna(last["macd_signal"])
        and float(last["macd"]) < float(last["macd_signal"])
        and pd.notna(last["volume_ratio"])
        and float(last["volume_ratio"]) >= 1.2
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

    if action == "BUY" and setup in ["BREAKOUT_55", "BREAKOUT_20"]:
        return (
            f"Thiết lập breakout đang hoạt động. Có thể mua theo vùng xác nhận {plan['entry_zone_low']} - {plan['entry_zone_high']}, "
            f"đặt cắt lỗ tại {plan['stop_loss']}, chốt lời TP1 {plan['take_profit_1']} và TP2 {plan['take_profit_2']}. "
            f"Ưu tiên giải ngân {plan['position_size_pct']}% vốn nếu giá giữ vững trên vùng breakout."
        )

    if action == "BUY" and setup == "PULLBACK_MA20":
        return (
            f"Cổ phiếu đang ở trạng thái pullback về MA20. Có thể canh mua quanh vùng {plan['entry_zone_low']} - {plan['entry_zone_high']}, "
            f"cắt lỗ tại {plan['stop_loss']}. Mục tiêu gần là {plan['take_profit_1']}, mục tiêu mở rộng {plan['take_profit_2']}."
        )

    if action == "HOLD":
        return (
            f"Xu hướng hiện vẫn tích cực. Ưu tiên nắm giữ, theo dõi trailing stop tại {plan['trailing_stop']} và cân nhắc gia tăng khi có nền tích lũy đẹp."
        )

    if action == "TAKE_PROFIT":
        return (
            "Cổ phiếu đã tăng nóng, RSI cao và độ lệch so với MA20 mở rộng. Ưu tiên chốt lời từng phần, giữ phần còn lại theo trailing stop."
        )

    if action == "SELL":
        return (
            "Tín hiệu suy yếu ngắn hạn đang xuất hiện khi giá đánh mất hỗ trợ gần và động lượng giảm. Ưu tiên hạ tỷ trọng để bảo toàn thành quả."
        )

    if action == "CUT_LOSS":
        return (
            f"Giá đã vi phạm vùng stop loss {plan['stop_loss']}. Kế hoạch phù hợp là cắt lỗ dứt khoát, không giữ vị thế trái kỷ luật."
        )

    return "Tín hiệu hiện chưa đủ đẹp để giải ngân mạnh. Ưu tiên quan sát thêm vùng nền giá và phản ứng quanh MA20."


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
    log("Bắt đầu update giá và tín hiệu")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    success_count = 0
    latest_market_ts = None

    try:
        cur.execute("select symbol from stocks order by symbol")
        symbols = [row[0] for row in cur.fetchall()]
        log(f"Tổng số mã cần xử lý: {len(symbols)}")

        for symbol in symbols:
            try:
                log(f"Đang xử lý {symbol}")

                df = fetch_history(symbol)
                log(f"{symbol} normalized rows: {len(df)}")

                if len(df) < 120:
                    log(f"FAIL {symbol} | Không đủ dữ liệu để tính MA100")
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
                df["volume_ratio"] = df["volume"] / df["volume_ma20"].replace(0, pd.NA)
                df["atr"] = calc_atr(df, 14)

                df["highest_20_prev"] = df["high"].rolling(20).max().shift(1)
                df["highest_55_prev"] = df["high"].rolling(55).max().shift(1)

                df["breakout_20"] = df["close"] > df["highest_20_prev"]
                df["breakout_55"] = df["close"] > df["highest_55_prev"]
                df["distance_ma20"] = ((df["close"] - df["ma20"]) / df["ma20"].replace(0, pd.NA)) * 100

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
                        bool(breakout_55),
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

                conn.commit()
                success_count += 1
                log(f"OK {symbol} | action={trade_plan['signal_action']} | score={total_score}")

            except Exception as e:
                conn.rollback()
                log(f"FAIL {symbol} | {e}")

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
