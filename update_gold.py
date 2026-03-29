import os
import re
from datetime import datetime, timezone

import pandas as pd
import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

SJC_URL = "https://sjc.com.vn/gia-vang-online"
DOJI_URL = "https://giavang.doji.vn/"


def log(message):
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def parse_number(value):
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    text = text.replace("\xa0", " ").replace(" ", "")
    text = text.replace(",", "")
    text = text.replace(".", "")

    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None

    try:
        return float(digits)
    except Exception:
        return None


def fetch_html(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; StockDashboardBot/1.0)",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    }
    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def scrape_sjc():
    html = fetch_html(SJC_URL)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    rows = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    current_time = datetime.now(timezone.utc)

    # Bắt các dòng kiểu:
    # Vàng SJC 1L, 10L, 1KG, 169,800,000, 172,800,000
    pattern = re.compile(r"^(.*?),\s*([\d\.,]+)\s*,\s*([\d\.,]+)$")

    for line in lines:
        m = pattern.match(line)
        if not m:
            continue

        gold_type = m.group(1).strip()
        buy_price = parse_number(m.group(2))
        sell_price = parse_number(m.group(3))

        if not gold_type or buy_price is None or sell_price is None:
            continue

        rows.append(
            {
                "source": "SJC",
                "gold_type": gold_type,
                "buy_price": buy_price,
                "sell_price": sell_price,
                "price_time": current_time,
            }
        )

    return rows


def scrape_doji():
    html = fetch_html(DOJI_URL)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    rows = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    current_time = datetime.now(timezone.utc)

    # Dữ liệu DOJI thường đi theo 3 dòng:
    # Tên loại
    # Mua
    # Bán
    #
    # Ví dụ trang hiện có các dòng như:
    # SJC -Bán Lẻ(nghìn/chỉ)
    # 16,980
    # 17,280
    #
    # Mình parse theo block.
    i = 0
    while i < len(lines) - 2:
        name = lines[i]
        buy = lines[i + 1]
        sell = lines[i + 2]

        buy_num = parse_number(buy)
        sell_num = parse_number(sell)

        # DOJI đang hiển thị nghìn/chỉ -> đổi sang VND/lượng để dễ so sánh hơn
        # 1 chỉ = 1/10 lượng, nên:
        # nghìn/chỉ * 1000 * 10 = VND/lượng
        if buy_num is not None and sell_num is not None and len(name) > 2:
            buy_price = buy_num * 1000 * 10
            sell_price = sell_num * 1000 * 10

            rows.append(
                {
                    "source": "DOJI",
                    "gold_type": name,
                    "buy_price": buy_price,
                    "sell_price": sell_price,
                    "price_time": current_time,
                }
            )
            i += 3
        else:
            i += 1

    return rows


def upsert_gold_rows(cur, rows):
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


def trim_gold_rows(cur):
    # giữ 30 bản ghi mới nhất cho mỗi source + gold_type
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
          where t.rn <= 30
        )
        """
    )


def main():
    log("Bắt đầu update gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    total_rows = 0

    try:
        try:
            sjc_rows = scrape_sjc()
            total_rows += upsert_gold_rows(cur, sjc_rows)
            conn.commit()
            log(f"SJC: ghi {len(sjc_rows)} dòng")
        except Exception as e:
            conn.rollback()
            log(f"SJC FAIL | {e}")

        try:
            doji_rows = scrape_doji()
            total_rows += upsert_gold_rows(cur, doji_rows)
            conn.commit()
            log(f"DOJI: ghi {len(doji_rows)} dòng")
        except Exception as e:
            conn.rollback()
            log(f"DOJI FAIL | {e}")

        trim_gold_rows(cur)
        conn.commit()

        log(f"Hoàn tất update gold | total_rows={total_rows}")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
