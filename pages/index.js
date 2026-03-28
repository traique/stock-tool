import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const [mode, setMode] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const endpoint = useMemo(() => {
    return mode === "dashboard" ? "/api/prices" : "/api/screener";
  }, [mode]);

  useEffect(() => {
    setLoading(true);
    fetch(endpoint)
      .then((res) => res.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setItems([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [endpoint]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerWrap}>
          <div>
            <div style={styles.eyebrow}>Công cụ cá nhân</div>
            <h1 style={styles.title}>📊 Stock Dashboard</h1>
            <div style={styles.subtitle}>
              Giá thật + RSI + MA20/50/100 + MACD + price action + lọc cổ phiếu
            </div>
          </div>
        </div>

        <div style={styles.tabs}>
          <button
            onClick={() => setMode("dashboard")}
            style={mode === "dashboard" ? styles.tabActive : styles.tab}
          >
            Dashboard
          </button>
          <button
            onClick={() => setMode("screener")}
            style={mode === "screener" ? styles.tabActive : styles.tab}
          >
            Screener
          </button>
        </div>

        <div style={styles.card}>
          <div style={styles.tableHeader}>
            <div>Mã</div>
            <div>Giá</div>
            <div>RSI</div>
            <div>MA</div>
            <div>MACD</div>
            <div>Action</div>
          </div>

          {loading ? (
            <div style={styles.empty}>Đang tải...</div>
          ) : items.length === 0 ? (
            <div style={styles.empty}>Chưa có dữ liệu phù hợp</div>
          ) : (
            items.map((item, idx) => {
              const f = item.fundamental || null;
              const rsiColor =
                item.rsi >= 70 ? "#dc2626" : item.rsi <= 30 ? "#16a34a" : "#111827";

              return (
                <div key={idx} style={styles.row}>
                  <div>
                    <div style={styles.symbol}>{item.symbol}</div>
                    {f?.industry ? <div style={styles.meta}>{f.industry}</div> : null}
                  </div>

                  <div>
                    <div style={styles.value}>{formatNum(item.close)}</div>
                    {f?.pe != null || f?.pb != null ? (
                      <div style={styles.meta}>
                        PE {formatNum(f?.pe)} · PB {formatNum(f?.pb)}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ ...styles.value, color: rsiColor }}>
                      {formatNum(item.rsi)}
                    </div>
                    <div style={styles.meta}>
                      {item.oversold ? "Quá bán" : item.overbought ? "Quá mua" : "Trung tính"}
                    </div>
                  </div>

                  <div>
                    <div style={styles.value}>
                      20: {formatNum(item.ma20)}
                    </div>
                    <div style={styles.meta}>
                      50: {formatNum(item.ma50)} · 100: {formatNum(item.ma100)}
                    </div>
                  </div>

                  <div>
                    <div style={styles.value}>
                      {formatNum(item.macd)}
                    </div>
                    <div style={styles.meta}>
                      Signal: {formatNum(item.macd_signal)}
                    </div>
                  </div>

                  <div>
                    <div style={styles.badges}>
                      {item.bullish_ma ? <span style={styles.badgeGreen}>MA+</span> : null}
                      {item.bullish_macd ? <span style={styles.badgeBlue}>MACD+</span> : null}
                      {item.price_action && item.price_action !== "neutral" ? (
                        <span style={styles.badgeGray}>{item.price_action}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function formatNum(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f3f4f6",
    padding: 16,
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: 1100,
    margin: "0 auto",
  },
  headerWrap: {
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    margin: 0,
    fontSize: 32,
    color: "#111827",
  },
  subtitle: {
    marginTop: 8,
    color: "#4b5563",
    fontSize: 14,
    lineHeight: 1.5,
  },
  tabs: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
  },
  tabActive: {
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 0.8fr 1.2fr 1fr 1.2fr",
    gap: 12,
    padding: 14,
    background: "#111827",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 0.8fr 1.2fr 1fr 1.2fr",
    gap: 12,
    padding: 14,
    borderTop: "1px solid #e5e7eb",
    alignItems: "center",
  },
  symbol: {
    fontSize: 18,
    fontWeight: 700,
    color: "#111827",
  },
  value: {
    fontSize: 15,
    fontWeight: 700,
    color: "#111827",
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
  },
  badges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  badgeGreen: {
    background: "#dcfce7",
    color: "#166534",
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  badgeBlue: {
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  badgeGray: {
    background: "#f3f4f6",
    color: "#374151",
    padding: "5px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  empty: {
    padding: 24,
    textAlign: "center",
    color: "#6b7280",
  },
};
