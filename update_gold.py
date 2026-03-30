import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

SJC_URL = "https://giavang.org/trong-nuoc/sjc/"
WORLD_URL = "https://giavang.org/the-gioi/"


def log(message: str) -> None:
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaPulseEliteBot/1.0)",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def parse_domestic_gold_to_vnd_per_luong(value):
    if value is None:
        return None

    raw = str(value).strip().replace("\xa0", " ").replace(" ", "")
    raw = raw.replace(",", ".")

    if not raw or not re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return None

    number = float(raw)

    if number >= 100_000_000:
        return int(round(number))

    if 1000 <= number < 1_000_000:
        return int(round(number * 1000))

    return int(round(number * 1_000_000))


def parse_world_price(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return None
    return float(m.group(1))


def parse_domestic_change(value):
    """
    Web thường hiển thị dạng:
    +1M / -1M / +1.0M / +500K / -0.5M
    Quy về VND/lượng.
    """
    if value is None:
        return None

    text = str(value).strip().upper().replace(" ", "").replace(",", ".")
    if not text:
        return None

    sign = -1 if text.startswith("-") else 1
    text = text.lstrip("+-")

    m = re.search(r"(\d+(?:\.\d+)?)(M|K)?", text)
    if not m:
        return None

    number = float(m.group(1))
    unit = m.group(2) or ""

    if unit == "M":
        value_num = int(round(number * 1_000_000))
    elif unit == "K":
        value_num = int(round(number * 1_000))
    else:
        value_num = int(round(number))

    return sign * value_num


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


def cleanup_bad_rows(cur):
    cur.execute(
        """
        delete from gold_prices
        where unit = 'VND/lượng'
          and (
            buy_price < 100000000
            or sell_price < 100000000
          )
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


def is_valid_row(row):
    buy_price = row.get("buy_price")
    sell_price = row.get("sell_price")
    gold_type = row.get("gold_type")

    if buy_price is None or sell_price is None:
        return False

    if gold_type in ("sjc_hcm", "ring_9999_hcm"):
        if buy_price < 100_000_000 or sell_price < 100_000_000:
            return False

    if gold_type == "world_xauusd":
        if buy_price < 1000 or sell_price < 1000:
            return False

    return True


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


def build_domestic_row(
    source,
    gold_type,
    display_name,
    subtitle,
    buy_price,
    sell_price,
    change_buy=None,
    change_sell=None,
):
    now_utc = datetime.now(timezone.utc)

    buy_price = parse_domestic_gold_to_vnd_per_luong(buy_price)
    sell_price = parse_domestic_gold_to_vnd_per_luong(sell_price)

    if change_buy is not None:
        change_buy = parse_domestic_change(change_buy)
    if change_sell is not None:
        change_sell = parse_domestic_change(change_sell)

    return {
        "source": source,
        "gold_type": gold_type,
        "display_name": display_name,
        "subtitle": subtitle,
        "buy_price": buy_price,
        "sell_price": sell_price,
        "unit": "VND/lượng",
        "change_buy": change_buy,
        "change_sell": change_sell,
        "price_time": now_utc,
    }


def fill_domestic_change_from_previous(cur, row):
    """
    Chỉ dùng fallback nếu web không parse ra change.
    """
    prev = get_previous_row(cur, row["source"], row["gold_type"])
    prev_buy = int(prev[0]) if prev and prev[0] is not None else None
    prev_sell = int(prev[1]) if prev and prev[1] is not None else None

    if row["change_buy"] is None and prev_buy is not None:
        delta = int(row["buy_price"]) - prev_buy
        row["change_buy"] = 0 if abs(delta) < 1000 else delta

    if row["change_sell"] is None and prev_sell is not None:
        delta = int(row["sell_price"]) - prev_sell
        row["change_sell"] = 0 if abs(delta) < 1000 else delta

    if row["change_buy"] is None:
        row["change_buy"] = 0
    if row["change_sell"] is None:
        row["change_sell"] = 0

    return row


def scrape_domestic_gold():
    html = fetch_html(SJC_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)

    rows = []

    # Pattern ưu tiên có cả 4 số: mua, bán, thay đổi mua, thay đổi bán
    sjc_pattern_full = re.search(
        r"Hồ Chí Minh\s+Vàng SJC 1L, 10L, 1KG\s+([\d\.,]+)\s+([\d\.,]+)\s+([+\-]?\d+(?:[\.,]\d+)?[MK]?)\s+([+\-]?\d+(?:[\.,]\d+)?[MK]?)",
        text,
        flags=re.IGNORECASE,
    )
    ring_pattern_full = re.search(
        r"Hồ Chí Minh\s+.*?Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ\s+([\d\.,]+)\s+([\d\.,]+)\s+([+\-]?\d+(?:[\.,]\d+)?[MK]?)\s+([+\-]?\d+(?:[\.,]\d+)?[MK]?)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Fallback chỉ có 2 số: mua, bán
    sjc_pattern_basic = re.search(
        r"Hồ Chí Minh\s+Vàng SJC 1L, 10L, 1KG\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE,
    )
    ring_pattern_basic = re.search(
        r"Hồ Chí Minh\s+.*?Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if sjc_pattern_full:
        rows.append(
            build_domestic_row(
                "giavang.org",
                "sjc_hcm",
                "Vàng miếng SJC",
                "SJC - Hồ Chí Minh",
                sjc_pattern_full.group(1),
                sjc_pattern_full.group(2),
                sjc_pattern_full.group(3),
                sjc_pattern_full.group(4),
            )
        )
    elif sjc_pattern_basic:
        rows.append(
            build_domestic_row(
                "giavang.org",
                "sjc_hcm",
                "Vàng miếng SJC",
                "SJC - Hồ Chí Minh",
                sjc_pattern_basic.group(1),
                sjc_pattern_basic.group(2),
            )
        )

    if ring_pattern_full:
        rows.append(
            build_domestic_row(
                "giavang.org",
                "ring_9999_hcm",
                "Vàng nhẫn 9999",
                "SJC - Hồ Chí Minh",
                ring_pattern_full.group(1),
                ring_pattern_full.group(2),
                ring_pattern_full.group(3),
                ring_pattern_full.group(4),
            )
        )
    elif ring_pattern_basic:
        rows.append(
            build_domestic_row(
                "giavang.org",
                "ring_9999_hcm",
                "Vàng nhẫn 9999",
                "SJC - Hồ Chí Minh",
                ring_pattern_basic.group(1),
                ring_pattern_basic.group(2),
            )
        )

    return rows


def scrape_world_gold():
    html = fetch_html(WORLD_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    now_utc = datetime.now(timezone.utc)

    price_match = re.search(
        r"Giá vàng quốc tế.*?là\s*([\d,]+\.\d+)\s*USD",
        text,
        flags=re.IGNORECASE,
    )
    if not price_match:
        price_match = re.search(r"([\d,]+\.\d+)\s*USD", text)

    if not price_match:
        return None

    price = parse_world_price(price_match.group(1))
    if price is None:
        return None

    delta = None
    up_match = re.search(r"tăng\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)
    down_match = re.search(r"giảm\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)

    if up_match:
        delta_val = parse_world_price(up_match.group(1))
        if delta_val is not None:
            delta = abs(delta_val)
    elif down_match:
        delta_val = parse_world_price(down_match.group(1))
        if delta_val is not None:
            delta = -abs(delta_val)

    if delta is None:
        delta = 0.0

    if abs(delta) < 0.01:
        delta = 0.0

    return {
        "source": "giavang.org",
        "gold_type": "world_xauusd",
        "display_name": "Vàng thế giới",
        "subtitle": "Vàng/Đô la Mỹ",
        "buy_price": float(price),
        "sell_price": float(price),
        "unit": "USD/ounce",
        "change_buy": float(delta),
        "change_sell": float(delta),
        "price_time": now_utc,
    }


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        cleanup_bad_rows(cur)

        domestic_rows = scrape_domestic_gold()
        domestic_rows = [row for row in domestic_rows if is_valid_row(row)]

        for row in domestic_rows:
            row = fill_domestic_change_from_previous(cur, row)
            insert_row(cur, row)

        world_row = scrape_world_gold()
        if world_row and is_valid_row(world_row):
            insert_row(cur, world_row)

        parsed_count = len(domestic_rows) + (1 if world_row and is_valid_row(world_row) else 0)
        log(f"Gold parsed valid rows: {parsed_count}")

        if parsed_count == 0:
            raise RuntimeError("update_gold parse ra 0 dòng hợp lệ")

        trim_gold_rows(cur)
        conn.commit()
        log("Done update_gold")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
