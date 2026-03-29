import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

PETROLIMEX_HANOI_URL = "https://hanoi.petrolimex.com.vn/index.html"
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


def normalize_fuel_name(name):
    text = str(name).strip()
    mapping = {
        "Xăng RON 95-V": "RON95-V",
        "Xăng RON 95-III": "RON95-III",
        "Xăng E10 RON 95-III": "E10 RON95-III",
        "Xăng E5 RON 92-II": "E5 RON92-II",
        "DO 0,001S-V": "Diesel 0.001S-V",
        "DO 0,05S-II": "Diesel 0.05S-II",
        "Dầu hỏa 2-K": "Dầu hỏa 2-K",
        "Mazút 2B (3,5S)": "Mazut 2B (3.5S)",
        "Mazút 180cst 0,5S (RMG)": "Mazut 180cst 0.5S (RMG)",
    }
    return mapping.get(text, text)


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


def build_pattern(product):
    # Chấp nhận:
    # Xăng RON 95-V · 24.730, 25.220
    # Xăng RON 95-III, 24.330, 24.810
    # Xăng RON 95-V : 24.730 25.220
    return re.compile(
        rf"{re.escape(product)}"
        rf"(?:\s*[·,:;-]?\s*|\s+)"
        rf"([\d][\d\.,]*)"
        rf"(?:\s*,\s*|\s+)"
        rf"([\d][\d\.,]*)",
        flags=re.IGNORECASE,
    )


def scrape_fuel():
    html = fetch_html(PETROLIMEX_HANOI_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)

    effective_time = parse_effective_time()

    product_names = [
        "Xăng RON 95-V",
        "Xăng RON 95-III",
        "Xăng E10 RON 95-III",
        "Xăng E5 RON 92-II",
        "DO 0,001S-V",
        "DO 0,05S-II",
        "Dầu hỏa 2-K",
        "Mazút 2B (3,5S)",
        "Mazút 180cst 0,5S (RMG)",
    ]

    rows = []

    for product in product_names:
        pattern = build_pattern(product)
        m = pattern.search(text)
        if not m:
            log(f"MISS {product}")
            continue

        region_1 = parse_number(m.group(1))
        region_2 = parse_number(m.group(2))

        log(f"MATCH {product} | raw1={m.group(1)} raw2={m.group(2)}")

        if region_1 is None:
            continue

        unit = "VND/kg" if "Mazút" in product or "Mazut" in product else "VND/liter"

        rows.append(
            {
                "fuel_type": normalize_fuel_name(product),
                "price": region_1,
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
