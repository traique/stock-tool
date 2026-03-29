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


def parse_effective_time_from_press():
    try:
        html = fetch_html(PETROLIMEX_PRESS_URL)
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text("\n", strip=True)

        # Ví dụ:
        # "Petrolimex điều chỉnh giá xăng dầu từ 24 giờ 00 phút ngày 26.3.2026"
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

        # lưu UTC đơn giản; UI sẽ format GMT+7
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


def scrape_petrolimex_hanoi():
    html = fetch_html(PETROLIMEX_HANOI_URL)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    effective_time = parse_effective_time_from_press()
    rows = []

    # Trang đang có các dòng kiểu:
    # Xăng RON 95-V
    # 24.730
    # 25.220
    #
    # hoặc
    # Xăng RON 95-III
    # 24.330
    # 24.810
    #
    # Mình lấy giá vùng 1 làm giá đại diện.
    fuel_keywords = [
        "Xăng RON 95-V",
        "Xăng RON 95-III",
        "Xăng E10 RON 95-III",
        "Xăng E5 RON 92-II",
        "DO 0,001S-V",
        "DO 0,05S-II",
        "Dầu hỏa",
        "Mazut",
    ]

    i = 0
    while i < len(lines) - 2:
        name = lines[i]
        region_1 = lines[i + 1]
        region_2 = lines[i + 2]

        if any(k.lower() in name.lower() for k in fuel_keywords):
            price = parse_number(region_1)
            if price is not None:
                rows.append(
                    {
                        "fuel_type": normalize_fuel_name(name),
                        "price": price,
                        "unit": "VND/liter",
                        "effective_time": effective_time,
                    }
                )
            i += 3
        else:
            i += 1

    return rows


def normalize_fuel_name(name):
    text = str(name).strip()

    mapping = {
        "Xăng RON 95-V": "RON95-V",
        "Xăng RON 95-III": "RON95-III",
        "Xăng E10 RON 95-III": "E10 RON95-III",
        "Xăng E5 RON 92-II": "E5 RON92-II",
        "DO 0,001S-V": "Diesel 0.001S-V",
        "DO 0,05S-II": "Diesel 0.05S-II",
        "Dầu hỏa": "Dầu hỏa",
        "Mazut": "Mazut",
    }

    for k, v in mapping.items():
        if k.lower() == text.lower():
            return v

    return text


def upsert_fuel_rows(cur, rows):
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


def trim_fuel_rows(cur):
    # giữ 20 bản ghi mới nhất cho mỗi fuel_type
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
          where t.rn <= 20
        )
        """
    )


def main():
    log("Bắt đầu update fuel")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        rows = scrape_petrolimex_hanoi()
        inserted = upsert_fuel_rows(cur, rows)
        trim_fuel_rows(cur)
        conn.commit()
        log(f"Hoàn tất update fuel | inserted={inserted}")
    except Exception as e:
        conn.rollback()
        log(f"FAIL fuel | {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
