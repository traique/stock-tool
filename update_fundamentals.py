import os
import re
import pandas as pd
import psycopg2
from vnstock import Company

DB_URL = os.environ["DB_URL"]


def safe_value(value):
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def pick_first(df: pd.DataFrame, candidates: list[str]):
    if df is None or len(df) == 0:
        return None
    lowered = {str(c).lower(): c for c in df.columns}
    for name in candidates:
        if name.lower() in lowered:
            value = df.iloc[0][lowered[name.lower()]]
            return safe_value(value)
    return None


def to_num(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return None if pd.isna(value) else float(value)

    text = str(value).strip()
    if text == "":
        return None

    text = text.replace(",", "")
    text = re.sub(r"[^\d\.\-]", "", text)
    if text in ("", "-", ".", "-."):
        return None

    try:
        return float(text)
    except ValueError:
        return None


def main():
    print("Starting fundamentals update...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("select symbol from stocks order by symbol")
    symbols = [row[0] for row in cur.fetchall()]
    print("Symbols:", symbols)

    for symbol in symbols:
        try:
            company = Company(symbol=symbol, source="VCI")
            overview = company.overview()

            company_name = pick_first(overview, ["company_name", "short_name", "company_profile"])
            industry = pick_first(overview, ["industry", "icb_name3", "icb_name2"])
            exchange = pick_first(overview, ["exchange", "listed_exchange"])
            market_cap = to_num(pick_first(overview, ["market_cap", "charter_capital", "listed_share"]))

            pe = to_num(pick_first(overview, ["pe", "p/e"]))
            pb = to_num(pick_first(overview, ["pb", "p/b"]))
            roe = to_num(pick_first(overview, ["roe"]))
            roa = to_num(pick_first(overview, ["roa"]))
            eps = to_num(pick_first(overview, ["eps"]))
            revenue_growth = to_num(pick_first(overview, ["revenue_growth", "growth_revenue"]))
            profit_growth = to_num(pick_first(overview, ["profit_growth", "growth_profit"]))
            debt_to_equity = to_num(pick_first(overview, ["debt_to_equity", "d/e"]))

            cur.execute(
                """
                insert into company_fundamentals
                (symbol, company_name, industry, exchange, market_cap, pe, pb, roe, roa, eps,
                 revenue_growth, profit_growth, debt_to_equity, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                on conflict (symbol) do update set
                  company_name = excluded.company_name,
                  industry = excluded.industry,
                  exchange = excluded.exchange,
                  market_cap = excluded.market_cap,
                  pe = excluded.pe,
                  pb = excluded.pb,
                  roe = excluded.roe,
                  roa = excluded.roa,
                  eps = excluded.eps,
                  revenue_growth = excluded.revenue_growth,
                  profit_growth = excluded.profit_growth,
                  debt_to_equity = excluded.debt_to_equity,
                  updated_at = now()
                """,
                (
                    symbol,
                    company_name,
                    industry,
                    exchange,
                    market_cap,
                    pe,
                    pb,
                    roe,
                    roa,
                    eps,
                    revenue_growth,
                    profit_growth,
                    debt_to_equity,
                ),
            )

            conn.commit()
            print(f"Fundamentals done {symbol}")
        except Exception as e:
            conn.rollback()
            print(f"Fundamentals error {symbol}: {e}")

    cur.close()
    conn.close()
    print("Finished fundamentals update.")


if __name__ == "__main__":
    main()
