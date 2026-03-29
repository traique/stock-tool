import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

FUEL_SOURCE_URL = "https://giaxanghomnay.com/"
PETROLIMEX_PRESS_URL = "https://www.petrolimex.com.vn/ndi/thong-cao-bao-chi.html"


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


def parse_number(text):
    if text is None:
        return None
    value = str(text).strip().replace("\xa0", " ").replace(" ", "")
    digits = re.sub(r"[^\d]", "", value)
    if not digits:
        return None
    return float(digits)


def parse_effective_time():
    try:
        html = fetch_html(PETROLIMEX_PRESS_URL)
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text("\n", strip=True)

        m = re.search(
            r"(\d{1,2})\s*giờ\s*(\d{2})\s*phút\s*ngày\s*(\d{1,2})\.(\d{1,2})\.(\d{4})",
            text,
            flags=re.IGNORECASE,
        )
        if not m:
            return datetime.now(timezone.utc)

        hour = int(m.group(1))
        minute = int(m.group(2))
        day = int(m.group(3))
        month = int(m.group(4))
        year = int(m.group(5))

        return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def normalize_lines(text):
    raw_lines = [x.strip() for x in text.splitlines()]
    lines = []
    for line in raw_lines:
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    return lines


def extract_best_price_from_text_block(block):
    candidates = re.findall(r"\d{1,3}(?:[.,]\d{3})+", block)
    nums = []

    for c in candidates:
        n = parse_number(c)
        if n is None:
            continue
        # lọc biên hợp lý cho giá xăng dầu VN
        if 10000 <= n <= 100000:
            nums.append(n)

    if not nums:
        return None

    return max(nums)


def scrape_fuel():
    html = fetch_html(FUEL_SOURCE_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    lines = normalize_lines(text)

    effective_time = parse_effective_time()

    products = [
        ("RON95-V", ["Xăng RON 95-V"]),
        ("RON95-III", ["Xăng RON 95-III"]),
        ("E10 RON95-III", ["Xăng E10 RON 95-III"]),
        ("E5 RON92-II", ["Xăng E5 RON 92-II"]),
        ("Diesel 0.001S-V", ["DO 0,001S-V"]),
        ("Diesel 0.05S-II", ["DO 0,05S-II"]),
        ("Dầu hỏa 2-K", ["Dầu hỏa 2-K"]),
        ("Mazut", ["Mazút", "Mazut"]),
    ]

    rows = []

    for fuel_type, keywords in products:
        matched_price = None

        for idx, line in enumerate(lines):
            lower_line = line.lower()
            if not any(k.lower() in lower_line for k in keywords):
                continue

            # gom block xung quanh dòng match để bắt giá gần nhất
            block_lines = lines[idx : min(idx + 6, len(lines))]
            block = " | ".join(block_lines)

            price = extract_best_price_from_text_block(block)
            if price is not None:
                matched_price = price
                log(f"MATCH {fuel_type} | price={price} | line={line}")
                break

        if matched_price is None:
            log(f"MISS {fuel_type}")
            continue

        unit = "VND/kg" if fuel_type == "Mazut" else "VND/liter"

        rows.append(
            {
                "fuel_type": fuel_type,
                "price": matched_price,
                "unit": unit,
                "effective_time": effective_time,
            }
        )

    dedup = {}
    for row in rows:
        dedup[row["fuel_type"]] = row

    return list(dedup.values())


def insert_rows(cur, rows):
    inserted = 0
    for row in rows:
        cur.execute(
            """
            insert into fuel_prices (fuel_type, price, unit, effective_time, created_at)
            values (%s, %s, %s, %s, now())
            """,
            (
                row["fuel_type"],
                row["price"],
                row["unit"],
                row["effective_time"],
            ),
        )
        inserted += 1
    return inserted


def trim_rows(cur):
    cur.execute(
        """
        delete from fuel_prices
        where id not in (
          select id from (
            select id,
                   row_number() over (
                     partition by fuel_type
                     order by effective_time desc, id desc
                   ) as rn
            from fuel_prices
          ) t
          where rn <= 20
        )
        """
    )


def main():
    log("Start update_fuel")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        rows = scrape_fuel()
        log(f"Fuel parsed {len(rows)} rows")

        if len(rows) == 0:
            raise RuntimeError("update_fuel parse ra 0 dòng")

        inserted = insert_rows(cur, rows)
        trim_rows(cur)
        conn.commit()

        if inserted == 0:
            raise RuntimeError("update_fuel không ghi được dòng nào")

        log(f"Done update_fuel | inserted={inserted}")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
