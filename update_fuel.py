import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

PRIMARY_URL = "https://webgia.com/gia-xang-dau/petrolimex/"
FALLBACK_URL = "https://giaxanghomnay.com/"
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


def expected_products():
    return [
        ("RON95-V", [r"Xăng\s*RON\s*95-V"]),
        ("RON95-III", [r"Xăng\s*RON\s*95-III"]),
        ("E5 RON92-II", [r"Xăng\s*E5\s*RON\s*92-II"]),
        ("E10 RON95-III", [r"Xăng\s*E10\s*RON\s*95-III"]),
        ("Diesel 0.001S-V", [r"DO\s*0,001S-V"]),
        ("Diesel 0.05S-II", [r"DO\s*0,05S-II"]),
        ("Dầu hỏa 2-K", [r"Dầu\s*hỏa\s*2-K"]),
    ]


def scrape_from_webgia():
    html = fetch_html(PRIMARY_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)

    rows = []
    effective_time = parse_effective_time()

    for fuel_type, patterns in expected_products():
        price = None

        for pattern in patterns:
            # Bắt 2 giá vùng 1 vùng 2, lấy vùng 1
            m = re.search(
                pattern + r"\s*([\d\.]+)\s*([\d\.]+)",
                text,
                flags=re.IGNORECASE,
            )
            if m:
                p1 = parse_number(m.group(1))
                p2 = parse_number(m.group(2))
                if p1 is not None and 10000 <= p1 <= 100000:
                    price = p1
                    log(f"WEBGIA MATCH {fuel_type} | p1={p1} p2={p2}")
                    break

        if price is None:
            log(f"WEBGIA MISS {fuel_type}")
            continue

        rows.append(
            {
                "fuel_type": fuel_type,
                "price": price,
                "unit": "VND/liter",
                "effective_time": effective_time,
            }
        )

    return rows


def scrape_from_giaxanghomnay():
    html = fetch_html(FALLBACK_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)

    rows = []
    effective_time = parse_effective_time()

    for fuel_type, patterns in expected_products():
        price = None

        for pattern in patterns:
            m = re.search(
                pattern + r".{0,80}?(\d{1,3}(?:[.,]\d{3})+)",
                text,
                flags=re.IGNORECASE,
            )
            if m:
                p1 = parse_number(m.group(1))
                if p1 is not None and 10000 <= p1 <= 100000:
                    price = p1
                    log(f"FALLBACK MATCH {fuel_type} | p1={p1}")
                    break

        if price is None:
            log(f"FALLBACK MISS {fuel_type}")
            continue

        rows.append(
            {
                "fuel_type": fuel_type,
                "price": price,
                "unit": "VND/liter",
                "effective_time": effective_time,
            }
        )

    return rows


def scrape_fuel():
    rows = scrape_from_webgia()
    if len(rows) >= 5:
        return rows

    log("Primary source chưa đủ dữ liệu, chuyển sang fallback")
    rows = scrape_from_giaxanghomnay()
    return rows


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
