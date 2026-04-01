import os
from datetime import datetime, timezone

import psycopg2
import requests

DB_URL = os.environ["DB_URL"]

API_BASE = "https://www.vang.today/api/prices"
TIMEOUT = 20

GOLD_TYPES = [
    {
        "code": "SJL1L10",
        "gold_type": "sjc_hcm",
        "display_name": "Vàng miếng SJC",
        "subtitle": "SJL1L10",
        "unit": "VND/lượng",
    },
    {
        "code": "SJ9999",
        "gold_type": "ring_9999_hcm",
        "display_name": "Nhẫn SJC",
        "subtitle": "SJ9999",
        "unit": "VND/lượng",
    },
    {
        "code": "XAUUSD",
        "gold_type": "world_xauusd",
        "display_name": "Vàng thế giới",
        "subtitle": "XAU/USD",
        "unit": "USD/ounce",
    },
]


def log(message: str) -> None:
    print(f"[{datetime.utcnow().isoformat()}Z] {message}", flush=True)


def fetch_json(code: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaPulseEliteBot/3.0)",
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    r = requests.get(f"{API_BASE}?type={code}", headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    payload = r.json()

    if not payload or not payload.get("success"):
        raise RuntimeError(f"vang.today API fail for {code}")

    data = payload.get("data") or []
    if not data:
        raise RuntimeError(f"vang.today API empty data for {code}")

    return data[0]


def parse_time(update_time):
    if update_time is None:
        return datetime.now(timezone.utc)

    try:
        ts = float(update_time)
        if ts > 1e12:
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


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


def is_valid_row(row: dict) -> bool:
    if row["buy_price"] is None or row["sell_price"] is None:
        return False

    if row["unit"] == "VND/lượng":
        return row["buy_price"] >= 100_000_000 and row["sell_price"] >= 100_000_000

    if row["gold_type"] == "world_xauusd":
        return row["buy_price"] >= 1000 and row["sell_price"] >= 1000

    return True


def build_row(meta: dict, api_row: dict) -> dict:
    if meta["unit"] == "VND/lượng":
        buy_price = int(api_row.get("buy") or 0)
        sell_price = int(api_row.get("sell") or 0)
        change_buy = int(api_row.get("change_buy") or 0)
        change_sell = int(api_row.get("change_sell") or 0)
    else:
        buy_price = float(api_row.get("buy") or 0)
        sell_price = float(api_row.get("sell") or 0)
        change_buy = float(api_row.get("change_buy") or 0)
        change_sell = float(api_row.get("change_sell") or 0)

    return {
        "source": "vang.today",
        "gold_type": meta["gold_type"],
        "display_name": meta["display_name"],
        "subtitle": meta["subtitle"],
        "buy_price": buy_price,
        "sell_price": sell_price,
        "unit": meta["unit"],
        "change_buy": change_buy,
        "change_sell": change_sell,
        "price_time": parse_time(api_row.get("update_time")),
    }


def insert_row(cur, row: dict) -> None:
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


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        cleanup_bad_rows(cur)

        rows = []
        for meta in GOLD_TYPES:
            api_row = fetch_json(meta["code"])
            row = build_row(meta, api_row)
            if is_valid_row(row):
                rows.append(row)
                log(
                    f"{row['gold_type']} | buy={row['buy_price']} | sell={row['sell_price']} | "
                    f"change_buy={row['change_buy']} | change_sell={row['change_sell']}"
                )
            else:
                log(f"SKIP invalid row: {row}")

        if not rows:
            raise RuntimeError("update_gold parse ra 0 dòng hợp lệ")

        for row in rows:
            insert_row(cur, row)

        trim_gold_rows(cur)
        conn.commit()
        log(f"Done update_gold | inserted {len(rows)} rows")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
