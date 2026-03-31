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


def clean_text(value):
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def parse_domestic_gold_to_vnd_per_luong(value):
    """
    Ví dụ:
    170.8   -> 170,800,000
    170,8   -> 170,800,000
    170.800 -> 170,800,000
    170800000 -> 170,800,000
    """
    raw = clean_text(value).replace(" ", "").replace(",", ".")
    if not raw:
        return None

    m = re.search(r"\d+(?:\.\d+)?", raw)
    if not m:
        return None

    number = float(m.group(0))

    if number >= 100_000_000:
        return int(round(number))

    if 1000 <= number < 1_000_000:
        return int(round(number * 1000))

    return int(round(number * 1_000_000))


def parse_world_price(value):
    raw = clean_text(value).replace(",", "")
    m = re.search(r"\d+(?:\.\d+)?", raw)
    if not m:
        return None
    return float(m.group(0))


def parse_domestic_change_to_vnd(value):
    """
    Ví dụ:
    +1M -> 1000000
    -1M -> -1000000
    +800,000 -> 800000
    ▲ 800,000 -> 800000
    ▼ 500,000 -> -500000
    +0.8M -> 800000
    """
    text = clean_text(value).upper().replace(" ", "")
    if not text:
        return None

    sign = 1
    if text.startswith("-") or "▼" in text:
        sign = -1
    elif text.startswith("+") or "▲" in text:
        sign = 1

    text = text.replace("▲", "").replace("▼", "")
    text = text.lstrip("+-")
    text = text.replace(",", ".")

    m = re.search(r"(\d+(?:\.\d+)?)(M|K)?", text)
    if not m:
        return None

    number = float(m.group(1))
    unit = m.group(2) or ""

    if unit == "M":
        amount = int(round(number * 1_000_000))
    elif unit == "K":
        amount = int(round(number * 1_000))
    else:
        # nếu không có hậu tố thì thử hiểu theo số đầy đủ
        # ví dụ 800000 hoặc 800.000
        if number >= 100000:
            amount = int(round(number))
        elif number >= 1000:
            amount = int(round(number))
        else:
            amount = int(round(number))

    return sign * amount


def parse_world_change(value):
    """
    Ví dụ:
    +11.13
    -8.52
    tăng 11.13 USD
    giảm 8.52 USD
    """
    text = clean_text(value).replace(",", "")
    if not text:
        return None

    sign = 1
    lower = text.lower()
    if text.startswith("-") or "giảm" in lower or "▼" in text:
        sign = -1

    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return None

    return sign * float(m.group(1))


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


def scrape_domestic_gold():
    html = fetch_html(SJC_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    now_utc = datetime.now(timezone.utc)

    rows = []

    # Ưu tiên pattern có đủ: mua, bán, thay đổi mua, thay đổi bán
    sjc_full = re.search(
        r"Hồ Chí Minh\s+Vàng SJC 1L, 10L, 1KG\s+([\d\.,]+)\s+([\d\.,]+)\s+([+\-▲▼]?\s*[\d\.,]+(?:M|K)?)\s+([+\-▲▼]?\s*[\d\.,]+(?:M|K)?)",
        text,
        flags=re.IGNORECASE,
    )
    ring_full = re.search(
        r"Hồ Chí Minh\s+.*?Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ\s+([\d\.,]+)\s+([\d\.,]+)\s+([+\-▲▼]?\s*[\d\.,]+(?:M|K)?)\s+([+\-▲▼]?\s*[\d\.,]+(?:M|K)?)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Fallback chỉ có mua, bán
    sjc_basic = re.search(
        r"Hồ Chí Minh\s+Vàng SJC 1L, 10L, 1KG\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE,
    )
    ring_basic = re.search(
        r"Hồ Chí Minh\s+.*?Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if sjc_full:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "sjc_hcm",
                "display_name": "Vàng miếng SJC",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(sjc_full.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(sjc_full.group(2)),
                "unit": "VND/lượng",
                "change_buy": parse_domestic_change_to_vnd(sjc_full.group(3)),
                "change_sell": parse_domestic_change_to_vnd(sjc_full.group(4)),
                "price_time": now_utc,
            }
        )
    elif sjc_basic:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "sjc_hcm",
                "display_name": "Vàng miếng SJC",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(sjc_basic.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(sjc_basic.group(2)),
                "unit": "VND/lượng",
                "change_buy": None,
                "change_sell": None,
                "price_time": now_utc,
            }
        )

    if ring_full:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "ring_9999_hcm",
                "display_name": "Vàng nhẫn 9999",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(ring_full.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(ring_full.group(2)),
                "unit": "VND/lượng",
                "change_buy": parse_domestic_change_to_vnd(ring_full.group(3)),
                "change_sell": parse_domestic_change_to_vnd(ring_full.group(4)),
                "price_time": now_utc,
            }
        )
    elif ring_basic:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "ring_9999_hcm",
                "display_name": "Vàng nhẫn 9999",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(ring_basic.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(ring_basic.group(2)),
                "unit": "VND/lượng",
                "change_buy": None,
                "change_sell": None,
                "price_time": now_utc,
            }
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

    change = None
    up_match = re.search(r"tăng\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)
    down_match = re.search(r"giảm\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)

    if up_match:
        parsed = parse_world_change(up_match.group(1))
        if parsed is not None:
            change = abs(parsed)
    elif down_match:
        parsed = parse_world_change(down_match.group(1))
        if parsed is not None:
            change = -abs(parsed)

    return {
        "source": "giavang.org",
        "gold_type": "world_xauusd",
        "display_name": "Vàng thế giới",
        "subtitle": "Vàng/Đô la Mỹ",
        "buy_price": float(price),
        "sell_price": float(price),
        "unit": "USD/ounce",
        "change_buy": change,
        "change_sell": change,
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
            row = fill_change_from_previous_if_missing(cur, row)
            insert_row(cur, row)

        world_row = scrape_world_gold()
        if world_row and is_valid_row(world_row):
            world_row = fill_change_from_previous_if_missing(cur, world_row)
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
