import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

SJC_URL = "https://sjc.com.vn/gia-vang-online"
DOJI_URL = "https://giavang.doji.vn/"


def log(message):
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def fetch_html(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; StockDashboardBot/1.0)",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    }
    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def parse_number(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("\xa0", " ").replace(" ", "")
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None
    return float(digits)


def scrape_sjc():
    html = fetch_html(SJC_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)

    # ví dụ hiện tại:
    # Vàng SJC 1L, 10L, 1KG, 168,600,000, 171,600,000
    pattern = re.compile(r"([^\n]+?),\s*([\d\.,]+)\s*,\s*([\d\.,]+)")
    now_utc = datetime.now(timezone.utc)

    rows = []
    for m in pattern.finditer(text):
        gold_type = m.group(1).strip()
        buy_price = parse_number(m.group(2))
        sell_price = parse_number(m.group(3))

        if not gold_type or buy_price is None or sell_price is None:
            continue

        # lọc bớt rác
        lower_name = gold_type.lower()
        if "vàng" not in lower_name and "nữ trang" not in lower_name and "sjc" not in lower_name:
            continue

        rows.append(
            {
                "source": "SJC",
                "gold_type": gold_type[:200],
                "buy_price": buy_price,
                "sell_price": sell_price,
                "price_time": now_utc,
            }
        )

    # loại trùng theo source + gold_type
    dedup = {}
    for row in rows:
        dedup[(row["source"], row["gold_type"])] = row

    return list(dedup.values())


def scrape_doji():
    html = fetch_html(DOJI_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)

    # ví dụ hiện tại:
    # SJC -Bán Lẻ(nghìn/chỉ)
    # 16,980
    # 17,280
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    now_utc = datetime.now(timezone.utc)

    rows = []
    i = 0
    while i < len(lines) - 2:
        name = lines[i]
        buy = parse_number(lines[i + 1])
        sell = parse_number(lines[i + 2])

        if buy is not None and sell is not None:
            lower_name = name.lower()
            if any(k in lower_name for k in ["sjc", "nhẫn", "nữ trang", "nguyên liệu", "kim tt"]):
                # DOJI đang hiển thị nghìn/chỉ -> đổi sang VND/lượng
                buy_price = buy * 1000 * 10
                sell_price = sell * 1000 * 10

                rows.append(
                    {
                        "source": "DOJI",
                        "gold_type": name[:200],
                        "buy_price": buy_price,
                        "sell_price": sell_price,
                        "price_time": now_utc,
                    }
                )
                i += 3
                continue
        i += 1

    dedup = {}
    for row in rows:
        dedup[(row["source"], row["gold_type"])] = row

    return list(dedup.values())


def insert_rows(cur, rows):
    inserted = 0
    for row in rows:
        cur.execute(
            """
            insert into gold_prices (source, gold_type, buy_price, sell_price, price_time, created_at)
            values (%s, %s, %s, %s, %s, now())
            """,
            (
                row["source"],
                row["gold_type"],
                row["buy_price"],
                row["sell_price"],
                row["price_time"],
            ),
        )
        inserted += 1
    return inserted


def trim_rows(cur):
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


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    total_inserted = 0
    source_success = 0

    try:
        for source_name, scraper in [("SJC", scrape_sjc), ("DOJI", scrape_doji)]:
            try:
                rows = scraper()
                log(f"{source_name}: parsed {len(rows)} rows")

                if len(rows) == 0:
                    raise RuntimeError(f"{source_name}: parse ra 0 dòng")

                inserted = insert_rows(cur, rows)
                conn.commit()
                total_inserted += inserted
                source_success += 1
                log(f"{source_name}: inserted {inserted}")
            except Exception as e:
                conn.rollback()
                log(f"{source_name} FAIL | {e}")

        if source_success == 0 or total_inserted == 0:
            raise RuntimeError("update_gold thất bại: không ghi được dòng nào")

        trim_rows(cur)
        conn.commit()
        log(f"Done update_gold | total_inserted={total_inserted}")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
