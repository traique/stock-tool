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
    """
    Chuẩn hóa giá vàng trong nước về VND/lượng.

    Các kiểu dữ liệu nguồn hay gặp:
    - 170.8
    - 170,8
    - 170.800
    - 170,800
    - 170800000

    Kết quả mong muốn:
    - 170.8     -> 170800000
    - 170.800   -> 170800000
    - 170800000 -> 170800000
    """
    if value is None:
        return None

    raw = str(value).strip().replace("\xa0", " ").replace(" ", "")
    raw = raw.replace(",", ".")

    if not raw:
        return None

    if not re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return None

    number = float(raw)

    # Đã là VND/lượng
    if number >= 100_000_000:
        return int(round(number))

    # Dạng 170.800 => hiểu là 170,800 triệu => 170,800,000
    if 1000 <= number < 1_000_000:
        return int(round(number * 1000))

    # Dạng 170.8 => hiểu là 170.8 triệu => 170,800,000
    return int(round(number * 1_000_000))


def parse_world_price(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return None
    return float(m.group(1))


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


def is_valid_row(row):
    buy_price = row.get("buy_price")
    sell_price = row.get("sell_price")
    gold_type = row.get("gold_type")

    if buy_price is None or sell_price is None:
        return False

    if gold_type in ("sjc_hcm", "ring_9999_hcm"):
        # vàng trong nước phải quanh hàng trăm triệu VND/lượng
        if buy_price < 100_000_000 or sell_price < 100_000_000:
            return False

    if gold_type == "world_xauusd":
        # vàng thế giới phải cỡ vài nghìn USD
        if buy_price < 1000 or sell_price < 1000:
            return False

    return True


def cleanup_bad_rows(cur):
    """
    Xóa các dòng test cũ bị sai đơn vị để tránh UI lấy nhầm.
    """
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


def insert_gold_row(cur, row):
    prev = get_previous_row(cur, row["source"], row["gold_type"])

    prev_buy = float(prev[0]) if prev and prev[0] is not None else None
    prev_sell = float(prev[1]) if prev and prev[1] is not None else None

    if row["gold_type"] in ("sjc_hcm", "ring_9999_hcm"):
        current_buy = int(row["buy_price"])
        current_sell = int(row["sell_price"])

        change_buy = None if prev_buy is None else current_buy - int(prev_buy)
        change_sell = None if prev_sell is None else current_sell - int(prev_sell)

        # triệt tiêu sai số lẻ nhỏ
        if change_buy is not None and abs(change_buy) < 1000:
            change_buy = 0
        if change_sell is not None and abs(change_sell) < 1000:
            change_sell = 0
    else:
        current_buy = float(row["buy_price"])
        current_sell = float(row["sell_price"])

        change_buy = None if prev_buy is None else current_buy - prev_buy
        change_sell = None if prev_sell is None else current_sell - prev_sell

        if change_buy is not None and abs(change_buy) < 0.01:
            change_buy = 0
        if change_sell is not None and abs(change_sell) < 0.01:
            change_sell = 0

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
            current_buy,
            current_sell,
            row["unit"],
            change_buy,
            change_sell,
            row["price_time"],
        ),
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


def scrape_sjc_and_ring():
    html = fetch_html(SJC_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    now_utc = datetime.now(timezone.utc)

    rows = []

    sjc_match = re.search(
        r"Hồ Chí Minh\s+Vàng SJC 1L, 10L, 1KG\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE,
    )
    if sjc_match:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "sjc_hcm",
                "display_name": "Vàng miếng SJC",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(sjc_match.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(sjc_match.group(2)),
                "unit": "VND/lượng",
                "price_time": now_utc,
            }
        )

    ring_match = re.search(
        r"Hồ Chí Minh\s+.*?Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ\s+([\d\.,]+)\s+([\d\.,]+)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if ring_match:
        rows.append(
            {
                "source": "giavang.org",
                "gold_type": "ring_9999_hcm",
                "display_name": "Vàng nhẫn 9999",
                "subtitle": "SJC - Hồ Chí Minh",
                "buy_price": parse_domestic_gold_to_vnd_per_luong(ring_match.group(1)),
                "sell_price": parse_domestic_gold_to_vnd_per_luong(ring_match.group(2)),
                "unit": "VND/lượng",
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

    forced_delta = None
    up_match = re.search(r"tăng\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)
    down_match = re.search(r"giảm\s*([-\d,\.]+)\s*USD", text, flags=re.IGNORECASE)

    if up_match:
        delta_val = parse_world_price(up_match.group(1))
        if delta_val is not None:
            forced_delta = abs(delta_val)
    elif down_match:
        delta_val = parse_world_price(down_match.group(1))
        if delta_val is not None:
            forced_delta = -abs(delta_val)

    return {
        "source": "giavang.org",
        "gold_type": "world_xauusd",
        "display_name": "Vàng thế giới",
        "subtitle": "Vàng/Đô la Mỹ",
        "buy_price": price,
        "sell_price": price,
        "unit": "USD/ounce",
        "price_time": now_utc,
        "forced_delta": forced_delta,
    }


def insert_world_gold(cur, row):
    delta = row.get("forced_delta")

    if delta is None:
        insert_gold_row(cur, row)
        return

    if abs(delta) < 0.01:
        delta = 0

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
            float(row["buy_price"]),
            float(row["sell_price"]),
            row["unit"],
            float(delta),
            float(delta),
            row["price_time"],
        ),
    )


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        cleanup_bad_rows(cur)

        rows = scrape_sjc_and_ring()
        world_row = scrape_world_gold()
        if world_row:
            rows.append(world_row)

        valid_rows = [row for row in rows if is_valid_row(row)]
        log(f"Gold parsed {len(rows)} rows | valid {len(valid_rows)} rows")

        if len(valid_rows) == 0:
            raise RuntimeError("update_gold parse ra 0 dòng hợp lệ")

        for row in valid_rows:
            if row["gold_type"] == "world_xauusd":
                insert_world_gold(cur, row)
            else:
                insert_gold_row(cur, row)

        trim_gold_rows(cur)
        conn.commit()
        log("Done update_gold")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
