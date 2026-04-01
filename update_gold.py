import os
import re
from datetime import datetime, timezone

import psycopg2
import requests
from bs4 import BeautifulSoup

DB_URL = os.environ["DB_URL"]

API_ALL_URL = "https://www.vang.today/api/prices"
API_TYPE_URL = "https://www.vang.today/api/prices?type={code}"
WEB_URL = "https://www.vang.today/"
TIMEOUT = 25

GOLD_TYPES = [
    {
        "code": "SJL1L10",
        "gold_type": "sjc_hcm",
        "display_name": "SJC 9999",
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


def http_get_json(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaPulseEliteBot/7.0)",
        "Accept": "application/json,text/plain,*/*",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    r = requests.get(url, headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def http_get_text(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaPulseEliteBot/7.0)",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    r = requests.get(url, headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def parse_unix_time(ts):
    if ts is None:
        return datetime.now(timezone.utc)
    try:
        value = float(ts)
        if value > 1e12:
            value = value / 1000.0
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def parse_vn_time(text: str):
    m = re.search(r"(\d{2}):(\d{2})\s+(\d{2})/(\d{2})", text or "")
    if not m:
        return datetime.now(timezone.utc)

    hour = int(m.group(1))
    minute = int(m.group(2))
    day = int(m.group(3))
    month = int(m.group(4))
    year = datetime.now().year

    local_dt = datetime(year, month, day, hour, minute)
    utc_ts = local_dt.replace(tzinfo=timezone.utc).timestamp() - 7 * 3600
    return datetime.fromtimestamp(utc_ts, tz=timezone.utc)


def parse_int_vnd(text: str):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def parse_float_usd(text: str):
    m = re.search(r"[\d,]+\.\d+", text or "")
    if not m:
        return None
    return float(m.group(0).replace(",", ""))


def parse_change_vnd(text: str):
    if not text:
        return 0
    normalized = str(text).strip()
    sign = -1 if ("↓" in normalized or normalized.startswith("-")) else 1
    digits = re.sub(r"[^\d]", "", normalized)
    return sign * int(digits) if digits else 0


def parse_change_usd(text: str):
    if not text:
        return 0.0
    normalized = str(text).strip()
    sign = -1 if ("↓" in normalized or normalized.startswith("-")) else 1
    m = re.search(r"\d+(?:\.\d+)?", normalized.replace(",", ""))
    return sign * float(m.group(0)) if m else 0.0


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
                     partition by gold_type
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


def build_row_from_api(meta: dict, api_row: dict) -> dict:
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
        "price_time": parse_unix_time(api_row.get("update_time") or api_row.get("time")),
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


def fetch_all_prices():
    try:
        payload = http_get_json(API_ALL_URL)
        if not payload or not payload.get("success"):
            log("API all prices returned success=false")
            return {}
        rows = payload.get("data") or []
        mapping = {}
        for row in rows:
            code = row.get("type_code")
            if code:
                mapping[code] = row
        log(f"API all prices count = {len(rows)}")
        return mapping
    except Exception as e:
        log(f"API all prices error: {e}")
        return {}


def fetch_type_price(code: str):
    try:
        payload = http_get_json(API_TYPE_URL.format(code=code))
        if not payload or not payload.get("success"):
            return None
        rows = payload.get("data") or []
        log(f"API type {code} rows = {len(rows)}")
        return rows[0] if rows else None
    except Exception as e:
        log(f"API type error {code}: {e}")
        return None


def scrape_page_tokens():
    html = http_get_text(WEB_URL)
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)
    log(f"WEB text length = {len(text)}")

    normalized = text.replace("\xa0", " ")
    normalized = re.sub(r"\s*\n\s*", " | ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)

    for keyword in ["SJL1L10", "SJ9999", "XAU/USD"]:
        if keyword in normalized:
            idx = normalized.find(keyword)
            start = max(0, idx - 180)
            end = min(len(normalized), idx + 420)
            log(f"FOUND [{keyword}] => {normalized[start:end]}")

    tokens = [t.strip() for t in normalized.split("|")]
    tokens = [t for t in tokens if t]
    return tokens, normalized


def find_token_block(tokens, key):
    try:
        idx = tokens.index(key)
    except ValueError:
        return None
    start = max(0, idx - 2)
    end = min(len(tokens), idx + 12)
    block = tokens[start:end]
    log(f"BLOCK {key} => {' || '.join(block)}")
    return block


def scrape_sjc_from_tokens(tokens):
    block = find_token_block(tokens, "SJL1L10")
    if not block:
        log("SJC NO BLOCK")
        return None

    try:
        idx = block.index("SJL1L10")
        buy = parse_int_vnd(block[idx + 1])
        change_buy = parse_change_vnd(block[idx + 3])
        sell = parse_int_vnd(block[idx + 4])
        change_sell = parse_change_vnd(block[idx + 6])
        price_time = parse_vn_time(block[idx + 8])

        row = {
            "source": "vang.today",
            "gold_type": "sjc_hcm",
            "display_name": "SJC 9999",
            "subtitle": "SJL1L10",
            "buy_price": buy,
            "sell_price": sell,
            "unit": "VND/lượng",
            "change_buy": change_buy,
            "change_sell": change_sell,
            "price_time": price_time,
        }
        log(f"SJC PARSED => {row}")
        return row
    except Exception as e:
        log(f"SJC PARSE ERROR => {e}")
        return None


def scrape_ring_from_tokens(tokens):
    block = find_token_block(tokens, "SJ9999")
    if not block:
        log("RING NO BLOCK")
        return None

    try:
        idx = block.index("SJ9999")
        buy = parse_int_vnd(block[idx + 1])
        change_buy = parse_change_vnd(block[idx + 3])
        sell = parse_int_vnd(block[idx + 4])
        change_sell = parse_change_vnd(block[idx + 6])
        price_time = parse_vn_time(block[idx + 8])

        row = {
            "source": "vang.today",
            "gold_type": "ring_9999_hcm",
            "display_name": "Nhẫn SJC",
            "subtitle": "SJ9999",
            "buy_price": buy,
            "sell_price": sell,
            "unit": "VND/lượng",
            "change_buy": change_buy,
            "change_sell": change_sell,
            "price_time": price_time,
        }
        log(f"RING PARSED => {row}")
        return row
    except Exception as e:
        log(f"RING PARSE ERROR => {e}")
        return None


def scrape_world_from_text(normalized: str):
    patterns = [
        r"XAU/USD\s*\|\s*\$?([\d,]+\.\d+)\s*\|\s*([↑↓]\s*[+\-]?\s*[\d,]+(?:\.\d+)?)",
        r"XAU/USD\s+\$?([\d,]+\.\d+)\s+([↑↓]\s*[+\-]?\s*[\d,]+(?:\.\d+)?)",
    ]
    for i, pattern in enumerate(patterns, start=1):
        m = re.search(pattern, normalized, flags=re.IGNORECASE)
        if m:
            price = parse_float_usd(m.group(1))
            change = parse_change_usd(m.group(2))
            row = {
                "source": "vang.today",
                "gold_type": "world_xauusd",
                "display_name": "Vàng thế giới",
                "subtitle": "XAU/USD",
                "buy_price": price,
                "sell_price": price,
                "unit": "USD/ounce",
                "change_buy": change,
                "change_sell": change,
                "price_time": datetime.now(timezone.utc),
            }
            log(f"WORLD PARSED pattern {i} => {row}")
            return row
    log("WORLD NO MATCH")
    return None


def main():
    log("Start update_gold")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    try:
        cleanup_bad_rows(cur)

        rows = []
        all_prices = fetch_all_prices()

        for meta in GOLD_TYPES:
            api_row = all_prices.get(meta["code"])
            if not api_row:
                log(f"Fallback fetch by type for {meta['code']}")
                api_row = fetch_type_price(meta["code"])

            if api_row:
                row = build_row_from_api(meta, api_row)
                if is_valid_row(row):
                    rows.append(row)
                    log(f"API OK {row['gold_type']} => buy={row['buy_price']} sell={row['sell_price']}")
            else:
                log(f"MISS API {meta['code']}")

        missing_types = {m["gold_type"] for m in GOLD_TYPES} - {r["gold_type"] for r in rows}

        if missing_types:
            log(f"Need web fallback for: {', '.join(sorted(missing_types))}")
            tokens, normalized = scrape_page_tokens()

            fallback_rows = [
                scrape_sjc_from_tokens(tokens),
                scrape_ring_from_tokens(tokens),
                scrape_world_from_text(normalized),
            ]

            for row in fallback_rows:
                if not row:
                    continue
                if row["gold_type"] not in missing_types:
                    continue
                if not is_valid_row(row):
                    log(f"SKIP invalid web row: {row}")
                    continue
                rows.append(row)
                log(
                    f"WEB OK {row['gold_type']} | buy={row['buy_price']} | sell={row['sell_price']} | "
                    f"change_buy={row['change_buy']} | change_sell={row['change_sell']}"
                )

        if not rows:
            raise RuntimeError("update_gold parse ra 0 dòng hợp lệ")

        final_map = {}
        for row in rows:
            final_map[row["gold_type"]] = row

        final_rows = list(final_map.values())

        for row in final_rows:
            insert_row(cur, row)

        trim_gold_rows(cur)
        conn.commit()
        log(f"Done update_gold | inserted {len(final_rows)} rows")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
