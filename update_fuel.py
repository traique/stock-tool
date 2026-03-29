import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

PETROLIMEX_PRESS_URL = "https://www.petrolimex.com.vn/ndi/thong-cao-bao-chi.html"
FUEL_NEWS_FALLBACK_URL = "https://dtinews.dantri.com.vn/vietnam-today/vietnam-cuts-fuel-prices-again-after-tax-reductions-20260327050401386.htm"


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


def normalize_fuel_name(name):
    mapping = {
        "E5 RON 92": ("E5 RON92", "VND/liter"),
        "RON 95": ("RON95-III", "VND/liter"),
        "Diesel": ("Diesel", "VND/liter"),
        "Kerosene": ("Dầu hỏa", "VND/liter"),
        "Mazut": ("Mazut", "VND/kg"),
    }
    return mapping[name]


def scrape_from_dtinews():
    html = fetch_html(FUEL_NEWS_FALLBACK_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)

    effective_time = parse_effective_time()

    patterns = {
        "E5 RON 92": r"E5\s*RON\s*92[^0-9]{0,40}(\d{1,3}(?:\.\d{3})+)",
        "RON 95": r"RON\s*95[^0-9]{0,40}(\d{1,3}(?:\.\d{3})+)",
        "Diesel": r"Diesel[^0-9]{0,40}(\d{1,3}(?:\.\d{3})+)",
        "Kerosene": r"kerosene[^0-9]{0,40}(\d{1,3}(?:\.\d{3})+)",
        "Mazut": r"mazut[^0-9]{0,40}(\d{1,3}(?:\.\d{3})+)",
    }

    rows = []

    for label, pattern in patterns.items():
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if not m:
            log(f"MISS {label}")
            continue

        price = parse_number(m.group(1))
        if price is None:
            log(f"MISS {label} | parse_number")
            continue

        fuel_type, unit = normalize_fuel_name(label)
        rows.append(
            {
                "fuel_type": fuel_type,
                "price": price,
                "unit": unit,
                "effective_time": effective_time,
            }
        )
        log(f"MATCH {label} | price={price}")

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
        rows = scrape_from_dtinews()
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
