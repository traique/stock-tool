import psycopg2
import os
import random

DB_URL = os.environ["DB_URL"]

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

cur.execute("select symbol from stocks")
symbols = [row[0] for row in cur.fetchall()]

for s in symbols:
    price = random.randint(10, 100)  # demo

    cur.execute(
        "insert into prices (symbol, price) values (%s, %s)",
        (s, price)
    )

conn.commit()
cur.close()
conn.close()
