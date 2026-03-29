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


def parse_number(value):
    if value is None:
        return None
    text = str(value).strip().replace("\xa0", " ").replace(" ", "")
    digits = re.sub(r"[^\d]", "", text)
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
        "Dầu hỏa": "Dầu hỏa",
        "Mazút 2B (3,5S)": "Mazut 2B (3.5S)",
        "Mazút 180cst 0,5S (RMG)": "Mazut 180cst 0.5S (RMG)",
    }
    for k, v in mapping.items():
        if k.lower() == text.lower():
            return v
    return text


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

        # lấy mốc VN time rồi lưu UTC đơn giản
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


def scrape_fuel():
    html = fetch_html(PETROLIMEX_HANOI_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    lines = [x.strip() for x in text.splitlines() if x.strip()]

    keywords = [
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

    effective_time = parse_effective_time()
    rows = []

    i = 0
    while i < len(lines) - 2:
        name = lines[i]

        if any(k.lower() == name.lower() for k in keywords):
            # vùng 1, vùng 2
            p1 = parse_number(lines[i + 1])
            p2 = parse_number(lines[i + 2])

            if p1 is not None:
                rows.append(
                    {
                        "fuel_type": normalize_fuel_name(name),
                        "price": p1,
                        "unit": "VND/liter",
                        "effective_time": effective_time,
                    }
                )
                i += 3
                continue
        i += 1

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
