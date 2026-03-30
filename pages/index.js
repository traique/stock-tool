import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const [mode, setMode] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [goldItems, setGoldItems] = useState([]);
  const [fuelItems, setFuelItems] = useState([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  const endpoint = useMemo(() => {
    if (mode === "dashboard") return "/api/prices";
    if (mode === "screener") return "/api/screener";
    if (mode === "gold") return "/api/gold";
    if (mode === "fuel") return "/api/fuel";
    return null;
  }, [mode]);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data || null);
    } catch {
      setStatus(null);
    }
  };

  const loadData = async () => {
    if (!endpoint) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(endpoint);
      const data = await res.json();

      if (mode === "gold") {
        setGoldItems(Array.isArray(data) ? data : []);
      } else if (mode === "fuel") {
        setFuelItems(Array.isArray(data) ? data : []);
      } else {
        setItems(Array.isArray(data) ? data : []);
      }
    } catch {
      if (mode === "gold") setGoldItems([]);
      else if (mode === "fuel") setFuelItems([]);
      else setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStocks = async () => {
    try {
      const res = await fetch("/api/stocks");
      const data = await res.json();
      setStocks(Array.isArray(data) ? data : []);
    } catch {
      setStocks([]);
    }
  };

  useEffect(() => {
    loadData();
  }, [endpoint]);

  useEffect(() => {
    loadStocks();
    loadStatus();
  }, []);

  const addStock = async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;

    try {
      await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      setNewSymbol("");
      await loadStocks();
    } catch {}
  };

  const removeStock = async (symbol) => {
    try {
      await fetch("/api/stocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });

      await loadStocks();

      if (mode !== "watchlist") {
        await loadData();
        await loadStatus();
      }
    } catch {}
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerWrap}>
          <div style={styles.topRow}>
            <div style={styles.titleWrap}>
              <div style={styles.eyebrow}>Công cụ cá nhân</div>
              <h1 style={styles.title}>📊 Stock Dashboard Pro</h1>
              <div style={styles.subtitle}>
                Cổ phiếu + tín hiệu giao dịch pro + giá vàng + giá xăng
              </div>
            </div>

            <div style={styles.updatedPanel}>
              <div style={styles.updatedSection}>
                <div style={styles.updatedLabel}>Dữ liệu thị trường mới nhất</div>
                <div style={styles.updatedValue}>
                  {formatDateTime(status?.last_updated) || "Chưa có dữ liệu"}
                </div>
              </div>

              <div style={styles.updatedDivider} />

              <div style={styles.updatedSection}>
                <div style={styles.updatedLabel}>GitHub update chạy lúc</div>
                <div style={styles.updatedValue}>
                  {formatDateTime(status?.github_update_at) || "Chưa có dữ liệu"}
                </div>
              </div>
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
          <button
            onClick={() => setMode("watchlist")}
            style={mode === "watchlist" ? styles.tabActive : styles.tab}
          >
            Watchlist
          </button>
          <button
            onClick={() => setMode("gold")}
            style={mode === "gold" ? styles.tabActive : styles.tab}
          >
            Giá vàng
          </button>
          <button
            onClick={() => setMode("fuel")}
            style={mode === "fuel" ? styles.tabActive : styles.tab}
          >
            Giá xăng
          </button>
        </div>

        {mode === "watchlist" ? (
          <div style={styles.watchlistCard}>
            <div style={styles.sectionTitle}>Quản lý watchlist</div>

            <div style={styles.addRow}>
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Nhập mã, ví dụ FPT"
                style={styles.input}
              />
              <button onClick={addStock} style={styles.addBtn}>
                Thêm
              </button>
            </div>

            <div style={styles.stockTags}>
              {stocks.map((s, idx) => (
                <div key={`${s.symbol}-${idx}`} style={styles.stockTag}>
                  <span>{s.symbol}</span>
                  <button onClick={() => removeStock(s.symbol)} style={styles.removeBtn}>
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div style={styles.smallNote}>
              Sau khi thêm hoặc xóa mã, chạy lại workflow để cập nhật dữ liệu.
            </div>
          </div>
        ) : loading ? (
          <div style={styles.empty}>Đang tải...</div>
        ) : mode === "gold" ? (
          goldItems.length === 0 ? (
            <div style={styles.empty}>Chưa có dữ liệu giá vàng</div>
          ) : (
            <div style={styles.goldBoard}>
              <div style={styles.goldHeaderRow}>
                <div style={styles.goldHeaderName}>Tên</div>
                <div style={styles.goldHeaderPrice}>Mua vào</div>
                <div style={styles.goldHeaderPrice}>Bán ra</div>
              </div>

              {goldItems.map((item, idx) => (
                <div key={`${item.gold_type}-${idx}`} style={styles.goldRow}>
                  <div style={styles.goldNameCol}>
                    <div style={styles.goldName}>{item.display_name || item.gold_type}</div>
                    <div style={styles.goldSubtitle}>{item.subtitle || item.source}</div>
                  </div>

                  <div style={styles.goldPriceCol}>
                    <div style={getGoldPriceStyle(item.change_buy)}>
                      {formatGoldValue(item.buy_price, item.unit)}
                    </div>
                    <div style={getGoldChangeStyle(item.change_buy)}>
                      {formatGoldChange(item.change_buy, item.unit)}
                    </div>
                  </div>

                  <div style={styles.goldPriceCol}>
                    <div style={getGoldPriceStyle(item.change_sell)}>
                      {formatGoldValue(item.sell_price, item.unit)}
                    </div>
                    <div style={getGoldChangeStyle(item.change_sell)}>
                      {formatGoldChange(item.change_sell, item.unit)}
                    </div>
                  </div>
                </div>
              ))}

              {goldItems[0]?.price_time ? (
                <div style={styles.goldFooter}>
                  Cập nhật: {formatDateTime(goldItems[0]?.price_time)}
                </div>
              ) : null}
            </div>
          )
        ) : mode === "fuel" ? (
          fuelItems.length === 0 ? (
            <div style={styles.empty}>Chưa có dữ liệu giá xăng</div>
          ) : (
            <div style={styles.fuelBoard}>
              <div style={styles.fuelHeader}>Giá xăng dầu hiện tại</div>
              <div style={styles.fuelGrid}>
                {fuelItems.map((item, idx) => (
                  <div key={`${item.fuel_type}-${idx}`} style={styles.fuelCard}>
                    <div style={styles.fuelName}>{item.fuel_type}</div>
                    <div style={styles.fuelPrice}>{formatPrice(item.price)}</div>
                    <div style={styles.fuelUnit}>{item.unit || "VND/liter"}</div>
                    <div style={styles.fuelTime}>{formatDateTime(item.effective_time)}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : items.length === 0 ? (
          <div style={styles.empty}>Chưa có dữ liệu phù hợp</div>
        ) : (
          items.map((item, idx) => {
            const f = item.fundamental || {};

            return (
              <div key={`${item.symbol}-${idx}`} style={styles.card}>
                <div style={styles.cardTop}>
                  <div>
                    <div style={styles.symbol}>{item.symbol}</div>
                    {f.industry ? <div style={styles.meta}>{f.industry}</div> : null}
                  </div>

                  <div style={styles.scoreBox}>
                    <div style={styles.scoreLabel}>Score</div>
                    <div style={styles.scoreValue}>{formatNum(item.total_score)}</div>
                  </div>
                </div>

                <div style={styles.actionStrip}>
                  <span style={getActionStyle(item.signal_action)}>
                    {item.signal_action || "WATCH"}
                  </span>
                  {item.signal_strength ? (
                    <span style={styles.badgeGray}>{item.signal_strength}</span>
                  ) : null}
                  {item.setup_type ? (
                    <span style={styles.badgeBlue}>{item.setup_type}</span>
                  ) : null}
                  {item.confidence_score != null ? (
                    <span style={styles.badgeGreen}>
                      Conf {formatNum(item.confidence_score)}
                    </span>
                  ) : null}
                </div>

                <div style={styles.grid}>
                  <Metric title="Giá" value={formatNum(item.close)} />
                  <Metric
                    title="RSI"
                    value={formatNum(item.rsi)}
                    sub={
                      item.overbought
                        ? "Quá mua"
                        : item.oversold
                        ? "Quá bán"
                        : "Trung tính"
                    }
                    color={
                      item.rsi >= 70
                        ? "#dc2626"
                        : item.rsi <= 30
                        ? "#16a34a"
                        : "#111827"
                    }
                  />
                  <Metric
                    title="MA"
                    value={`20: ${formatNum(item.ma20)}`}
                    sub={`50: ${formatNum(item.ma50)} · 100: ${formatNum(item.ma100)}`}
                  />
                  <Metric
                    title="MACD"
                    value={formatNum(item.macd)}
                    sub={`Signal: ${formatNum(item.macd_signal)}`}
                    color={item.macd > 0 ? "#16a34a" : "#dc2626"}
                  />
                  <Metric
                    title="Volume"
                    value={formatNum(item.volume_ratio)}
                    sub={`MA20: ${formatNum(item.volume_ma20)}`}
                  />
                  <Metric
                    title="Breakout"
                    value={item.breakout_55 ? "55 phiên" : item.breakout_20 ? "20 phiên" : "-"}
                    sub={`Cách MA20: ${formatNum(item.distance_ma20)}%`}
                  />
                </div>

                <div style={styles.badges}>
                  {item.bullish_ma ? <span style={styles.badgeGreen}>MA+</span> : null}
                  {item.bullish_macd ? <span style={styles.badgeBlue}>MACD+</span> : null}
                  {item.breakout_20 ? <span style={styles.badgeOrange}>BO20</span> : null}
                  {item.breakout_55 ? <span style={styles.badgeRed}>BO55</span> : null}
                  {item.price_action && item.price_action !== "neutral" ? (
                    <span style={styles.badgeGray}>{item.price_action}</span>
                  ) : null}
                </div>

                <div style={styles.tradePlanBox}>
                  <div style={styles.noteTitle}>Kế hoạch giao dịch</div>
                  <div style={styles.tradeGrid}>
                    <TradeField label="Điểm vào" value={formatNum(item.entry_price)} />
                    <TradeField
                      label="Vùng mua"
                      value={
                        item.entry_zone_low != null && item.entry_zone_high != null
                          ? `${formatNum(item.entry_zone_low)} - ${formatNum(
                              item.entry_zone_high
                            )}`
                          : "-"
                      }
                    />
                    <TradeField label="SL" value={formatNum(item.stop_loss)} />
                    <TradeField label="TP1" value={formatNum(item.take_profit_1)} />
                    <TradeField label="TP2" value={formatNum(item.take_profit_2)} />
                    <TradeField label="Trailing" value={formatNum(item.trailing_stop)} />
                    <TradeField label="R/R" value={formatNum(item.risk_reward_ratio)} />
                    <TradeField
                      label="Tỷ trọng"
                      value={
                        item.position_size_pct != null
                          ? `${formatNum(item.position_size_pct)}%`
                          : "-"
                      }
                    />
                  </div>
                </div>

                {item.expert_strategy_note ? (
                  <div style={styles.noteBox}>
                    <div style={styles.noteTitle}>Nhận định chuyên gia</div>
                    <div style={styles.noteText}>{item.expert_strategy_note}</div>
                  </div>
                ) : item.expert_note ? (
                  <div style={styles.noteBox}>
                    <div style={styles.noteTitle}>Nhận định</div>
                    <div style={styles.noteText}>{item.expert_note}</div>
                  </div>
                ) : null}

                {f.pe != null || f.pb != null || f.roe != null ? (
                  <div style={styles.fundBox}>
                    <div style={styles.noteTitle}>Cơ bản</div>
                    <div style={styles.fundRow}>
                      <span>PE: {formatNum(f.pe)}</span>
                      <span>PB: {formatNum(f.pb)}</span>
                      <span>ROE: {formatNum(f.roe)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Metric({ title, value, sub, color }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: color || "#111827" }}>{value}</div>
      {sub ? <div style={styles.metricSub}>{sub}</div> : null}
    </div>
  );
}

function TradeField({ label, value }) {
  return (
    <div style={styles.tradeField}>
      <div style={styles.tradeLabel}>{label}</div>
      <div style={styles.tradeValue}>{value}</div>
    </div>
  );
}

function formatNum(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("vi-VN");
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  return (
    d.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " GMT+7"
  );
}

function formatGoldValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "-";

  if (unit === "VND/lượng") {
    return `${(Number(value) / 1_000_000).toFixed(1)}M`;
  }

  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatGoldChange(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "";

  if (unit === "VND/lượng") {
    const sign = Number(value) > 0 ? "+" : "";
    return `${sign}${(Number(value) / 1_000_000).toFixed(1)}M`;
  }

  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}`;
}

function getGoldPriceStyle(change) {
  return change == null
    ? styles.goldNeutral
    : Number(change) >= 0
    ? styles.goldUp
    : styles.goldDown;
}

function getGoldChangeStyle(change) {
  return change == null
    ? styles.goldChangeNeutral
    : Number(change) >= 0
    ? styles.goldChangeUp
    : styles.goldChangeDown;
}

function getActionStyle(action) {
  if (action === "BUY") return styles.actionBuy;
  if (action === "HOLD") return styles.actionHold;
  if (action === "TAKE_PROFIT") return styles.actionTp;
  if (action === "SELL" || action === "CUT_LOSS") return styles.actionSell;
  return styles.actionWatch;
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f3f4f6",
    padding: 16,
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: 960,
    margin: "0 auto",
  },
  headerWrap: {
    marginBottom: 16,
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  titleWrap: {
    flex: 1,
    minWidth: 260,
  },
  updatedPanel: {
    background: "#fff",
    padding: 14,
    borderRadius: 14,
    minWidth: 280,
    boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  updatedSection: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  updatedDivider: {
    height: 1,
    background: "#e5e7eb",
    width: "100%",
  },
  updatedLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  updatedValue: {
    fontSize: 14,
    fontWeight: 700,
    color: "#111827",
    lineHeight: 1.4,
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
    fontSize: 30,
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
    flexWrap: "wrap",
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
  watchlistCard: {
    background: "#fff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  sectionTitle: {
    fontWeight: 700,
    marginBottom: 10,
    color: "#111827",
  },
  addRow: {
    display: "flex",
    gap: 8,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 14,
  },
  addBtn: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  stockTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  stockTag: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#eef2ff",
    color: "#1e3a8a",
    padding: "8px 12px",
    borderRadius: 999,
    fontWeight: 700,
  },
  removeBtn: {
    border: "none",
    background: "transparent",
    color: "#dc2626",
    fontSize: 18,
    cursor: "pointer",
    fontWeight: 700,
    lineHeight: 1,
  },
  smallNote: {
    marginTop: 10,
    fontSize: 12,
    color: "#6b7280",
  },
  card: {
    background: "#fff",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  symbol: {
    fontSize: 20,
    fontWeight: 800,
    color: "#111827",
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    color: "#6b7280",
  },
  scoreBox: {
    textAlign: "right",
  },
  scoreLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: 800,
    color: "#111827",
  },
  actionStrip: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  actionBuy: {
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  actionHold: {
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  actionWatch: {
    background: "#fef3c7",
    color: "#92400e",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  actionTp: {
    background: "#ffedd5",
    color: "#c2410c",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  actionSell: {
    background: "#fee2e2",
    color: "#b91c1c",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  metricCard: {
    background: "#f9fafb",
    borderRadius: 12,
    padding: 10,
  },
  metricTitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1.1,
  },
  metricSub: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.4,
  },
  badges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  badgeGreen: {
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  badgeBlue: {
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  badgeOrange: {
    background: "#ffedd5",
    color: "#c2410c",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  badgeRed: {
    background: "#fee2e2",
    color: "#b91c1c",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  badgeGray: {
    background: "#f3f4f6",
    color: "#374151",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  tradePlanBox: {
    marginTop: 12,
    background: "#eff6ff",
    borderRadius: 12,
    padding: 10,
  },
  tradeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  tradeField: {
    background: "#fff",
    borderRadius: 10,
    padding: 10,
  },
  tradeLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
  },
  tradeValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "#111827",
  },
  noteBox: {
    marginTop: 12,
    background: "#f8fafc",
    borderRadius: 12,
    padding: 10,
  },
  noteTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 6,
  },
  noteText: {
    fontSize: 13,
    color: "#111827",
    lineHeight: 1.5,
  },
  fundBox: {
    marginTop: 12,
    background: "#fafaf9",
    borderRadius: 12,
    padding: 10,
  },
  fundRow: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 13,
    color: "#111827",
    fontWeight: 600,
  },
  empty: {
    background: "#fff",
    borderRadius: 16,
    padding: 24,
    textAlign: "center",
    color: "#6b7280",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },

  goldBoard: {
    background: "#0b0b0b",
    borderRadius: 18,
    padding: 18,
    color: "#fff",
  },
  goldHeaderRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr 1fr",
    gap: 12,
    marginBottom: 18,
    color: "#a1a1aa",
    fontWeight: 700,
    fontSize: 16,
  },
  goldHeaderName: {},
  goldHeaderPrice: {
    textAlign: "right",
  },
  goldRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr 1fr",
    gap: 12,
    padding: "18px 0",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  goldNameCol: {},
  goldName: {
    fontSize: 26,
    fontWeight: 800,
    color: "#f8fafc",
    lineHeight: 1.2,
  },
  goldSubtitle: {
    marginTop: 8,
    fontSize: 16,
    color: "#a1a1aa",
  },
  goldPriceCol: {
    textAlign: "right",
  },
  goldUp: {
    fontSize: 28,
    fontWeight: 800,
    color: "#22c55e",
  },
  goldDown: {
    fontSize: 28,
    fontWeight: 800,
    color: "#fb7185",
  },
  goldNeutral: {
    fontSize: 28,
    fontWeight: 800,
    color: "#e5e7eb",
  },
  goldChangeUp: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: 700,
    color: "#22c55e",
  },
  goldChangeDown: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: 700,
    color: "#fb7185",
  },
  goldChangeNeutral: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: 700,
    color: "#a1a1aa",
  },
  goldFooter: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    color: "#a1a1aa",
    fontSize: 13,
  },

  fuelBoard: {
    background: "#fff",
    borderRadius: 18,
    padding: 18,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  fuelHeader: {
    fontSize: 18,
    fontWeight: 800,
    color: "#111827",
    marginBottom: 14,
  },
  fuelGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  fuelCard: {
    background: "#f9fafb",
    borderRadius: 14,
    padding: 14,
  },
  fuelName: {
    fontSize: 18,
    fontWeight: 800,
    color: "#111827",
    marginBottom: 10,
  },
  fuelPrice: {
    fontSize: 28,
    fontWeight: 800,
    color: "#16a34a",
    lineHeight: 1.1,
  },
  fuelUnit: {
    marginTop: 6,
    fontSize: 13,
    color: "#6b7280",
  },
  fuelTime: {
    marginTop: 10,
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.4,
  },
};
