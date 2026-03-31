import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

VANG_TODAY_URL = "https://vang.today/vi/"


def log(message: str) -> None:
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaPulseEliteBot/2.0)",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def clean_text(value):
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def parse_vnd(value):
    text = clean_text(value)
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None
    return int(digits)


def parse_usd(value):
    text = clean_text(value).replace(",", "")
    m = re.search(r"\d+(?:\.\d+)?", text)
    if not m:
        return None
    return float(m.group(0))


def parse_vnd_change(value):
    text = clean_text(value)
    if not text or text in {"-", "./.", "-/-"}:
        return 0

    sign = 1
    if "↓" in text or text.strip().startswith("-"):
        sign = -1
    elif "↑" in text or text.strip().startswith("+"):
        sign = 1

    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return 0

    return sign * int(digits)


def parse_usd_change(value):
    text = clean_text(value)
    if not text or text in {"-", ".", "./.", "-/-"}:
        return 0.0

    sign = 1
    if "↓" in text or text.strip().startswith("-"):
        sign = -1
    elif "↑" in text or text.strip().startswith("+"):
        sign = 1

    m = re.search(r"\d+(?:\.\d+)?", text.replace(",", ""))
    if not m:
        return 0.0

    return sign * float(m.group(0))


def parse_price_time_vn(value: str):
    text = clean_text(value)

    # ví dụ: 15:30 19/03
    m = re.search(r"(\d{2}):(\d{2})\s+(\d{2})/(\d{2})", text)
    if not m:
        return datetime.now(timezone.utc)

    hour = int(m.group(1))
    minute = int(m.group(2))
    day = int(m.group(3))
    month = int(m.group(4))
    year = datetime.now().year

    # đổi từ giờ VN sang UTC
    dt_local = datetime(year, month, day, hour, minute)
    dt_utc = dt_local.replace(tzinfo=timezone.utc).timestamp() - 7 * 3600
    return datetime.fromtimestamp(dt_utc, tz=timezone.utc)


def cleanup_bad_rows(cur):
    cur.execute(
        """
        delete from gold_prices
        where unit = 'VND/lượng'
          and (buy_price < 100000000 or sell_price < 100000000)
        """
    )


def trim_gold_rows(cur):
    cur.execute(
        """
        delete from gold_prices
        where id not in (
          select id from (
            select id,
                   row_number() over (
                     partition by source, gold_type
                     order by price_time desc, id desc
                   ) as rn
            from gold_prices
          ) t
          where rn <= 30
        )
        """
    )


def insert_row(cur, row):
    cur.execute(
        """
        insert into gold_prices (
          source, gold_type, display_name, subtitle, buy_price, sell_price,
          unit, change_buy, change_sell, price_time, created_at
        )
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
        """,
        (
            row["source"],
            row["gold_type"],
            row["display_name"],
            row["subtitle"],
            row["buy_price"],
            row["sell_price"],
            row["unit"],
            row["change_buy"],
            row["change_sell"],
            row["price_time"],
        ),
    )


def get_previous_row(cur, source, gold_type):
    cur.execute(
        """
        select buy_price, sell_price
        from gold_prices
        where source = %s and gold_type = %s
        order by price_time desc, id desc
        limit 1
        """,
        (source, gold_type),
    )
    return cur.fetchone()


def fill_change_from_previous_if_missing(cur, row):
    prev = get_previous_row(cur, row["source"], row["gold_type"])
    prev_buy = prev[0] if prev and prev[0] is not None else None
    prev_sell = prev[1] if prev and prev[1] is not None else None

    if row["unit"] == "VND/lượng":
        if row["change_buy"] is None and prev_buy is not None:
            delta = int(row["buy_price"]) - int(prev_buy)
            row["change_buy"] = 0 if abs(delta) < 1000 else delta

        if row["change_sell"] is None and prev_sell is not None:
            delta = int(row["sell_price"]) - int(prev_sell)
            row["change_sell"] = 0 if abs(delta) < 1000 else delta

        if row["change_buy"] is None:
            row["change_buy"] = 0
        if row["change_sell"] is None:
            row["change_sell"] = 0
    else:
        if row["change_buy"] is None and prev_buy is not None:
            delta = float(row["buy_price"]) - float(prev_buy)
            row["change_buy"] = 0.0 if abs(delta) < 0.01 else float(delta)

        if row["change_sell"] is None and prev_sell is not None:
            delta = float(row["sell_price"]) - float(prev_sell)
            row["change_sell"] = 0.0 if abs(delta) < 0.01 else float(delta)

        if row["change_buy"] is None:
            row["change_buy"] = 0.0
        if row["change_sell"] is None:
            row["change_sell"] = 0.0

    return row


def is_valid_row(row):
    if row["buy_price"] is None or row["sell_price"] is None:
        return False

    if row["gold_type"] in ("sjc_hcm", "ring_9999_hcm"):
        return row["buy_price"] >= 100_000_000 and row["sell_price"] >= 100_000_000

    if row["gold_type"] == "world_xauusd":
        return row["buy_price"] >= 1000 and row["sell_price"] >= 1000

    return True


def extract_text_blocks():
    html = fetch_html(VANG_TODAY_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    return text


def scrape_world_gold(text: str):
    # block gần đầu trang:
    # XAU/USD
    # $4,675.10
    # ↓ -206.50
    world_match = re.search(
        r"XAU/USD\s+\$?([\d,]+\.\d+)\s+([↑↓]?\s*[+\-]?\s*[\d,]+(?:\.\d+)?)",
        text,
        flags=re.IGNORECASE,
    )

    if not world_match:
        return None

    price = parse_usd(world_match.group(1))
    change = parse_usd_change(world_match.group(2))

    if price is None:
        return None

    # ưu tiên lấy dòng cập nhật chi tiết đầu tiên
    time_match = re.search(
        r"XAU/USD.*?Ngày Giá \(USD\) Thay đổi Cập nhật\s+\d{2}/\d{2}\s+\$?[\d,]+\.\d+\s+[↑↓\-]?\s*[+\-]?\d+(?:\.\d+)?\s+(\d{2}:\d{2}\s+\d{2}/\d{2})",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    price_time = parse_price_time_vn(time_match.group(1)) if time_match else datetime.now(timezone.utc)

    return {
        "source": "vang.today",
        "gold_type": "world_xauusd",
        "display_name": "Vàng thế giới",
        "subtitle": "XAU/USD",
        "buy_price": float(price),
        "sell_price": float(price),
        "unit": "USD/ounce",
        "change_buy": float(change),
        "change_sell": float(change),
        "price_time": price_time,
    }


def scrape_sjc_gold(text: str):
    # block:
    # SJC 9999
    # SJL1L10
    # 172.500.000₫
    # ↓ -7.500.000
    # 175.500.000₫
    # ↓ -7.500.000
    # Giảm
    # 15:30 19/03
    m = re.search(
        r"SJC\s+9999\s+SJL1L10\s+([\d\.]+₫)\s+([↑↓\-]?\s*[+\-]?\s*[\d\.]+)?\s+([\d\.]+₫)\s+([↑↓\-]?\s*[+\-]?\s*[\d\.]+)?\s+\S+\s+(\d{2}:\d{2}\s+\d{2}/\d{2})",
        text,
        flags=re.IGNORECASE,
    )
    if not m:
        return None

    return {
        "source": "vang.today",
        "gold_type": "sjc_hcm",
        "display_name": "Vàng miếng SJC",
        "subtitle": "SJC 9999",
        "buy_price": parse_vnd(m.group(1)),
        "sell_price": parse_vnd(m.group(3)),
        "unit": "VND/lượng",
        "change_buy": parse_vnd_change(m.group(2)),
        "change_sell": parse_vnd_change(m.group(4)),
        "price_time": parse_price_time_vn(m.group(5)),
    }


def scrape_ring_gold(text: str):
    # block:
    # Nhẫn SJC
    # SJ9999
    # 172.200.000₫
    # ↓ -7.500.000
    # 175.200.000₫
    # ↓ -7.500.000
    # Giảm
    # 15:30 19/03
    m = re.search(
        r"Nhẫn\s+SJC\s+SJ9999\s+([\d\.]+₫)\s+([↑↓\-]?\s*[+\-]?\s*[\d\.]+)?\s+([\d\.]+₫)\s+([↑↓\-]?\s*[+\-]?\s*[\d\.]+)?\s+\S+\s+(\d{2}:\d{2}\s+\d{2}/\d{2})",
        text,
        flags=re.IGNORECASE,
    )
    if not m:
        return None

    return {
        "source": "vang.today",
        "gold_type": "ring_9999_hcm",
        "display_name": "Vàng nhẫn 9999",
        "subtitle": "Nhẫn SJC",
        "buy_price": parse_vnd(m.group(1)),
        "sell_price": parse_vnd(m.group(3)),
        "unit": "VND/lượng",
        "change_buy": parse_vnd_change(m.group(2)),
        "change_sell": parse_vnd_change(m.group(4)),
        "price_time": parse_price_time_vn(m.group(5)),
    }


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        cleanup_bad_rows(cur)

        text = extract_text_blocks()

        rows = []

        sjc_row = scrape_sjc_gold(text)
        if sjc_row and is_valid_row(sjc_row):
            rows.append(fill_change_from_previous_if_missing(cur, sjc_row))

        ring_row = scrape_ring_gold(text)
        if ring_row and is_valid_row(ring_row):
            rows.append(fill_change_from_previous_if_missing(cur, ring_row))

        world_row = scrape_world_gold(text)
        if world_row and is_valid_row(world_row):
            rows.append(fill_change_from_previous_if_missing(cur, world_row))

        for row in rows:
            insert_row(cur, row)
            log(
                f"Inserted {row['gold_type']} | buy={row['buy_price']} | sell={row['sell_price']} | source={row['source']}"
            )

        if len(rows) == 0:
            raise RuntimeError("update_gold parse ra 0 dòng hợp lệ từ vang.today")

        trim_gold_rows(cur)
        conn.commit()
        log(f"Done update_gold | inserted_rows={len(rows)}")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
