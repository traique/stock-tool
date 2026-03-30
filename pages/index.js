import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const [mode, setMode] = useState("dashboard");
  const [theme, setTheme] = useState("light");
  const [items, setItems] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [goldItems, setGoldItems] = useState([]);
  const [fuelItems, setFuelItems] = useState([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const savedTheme =
      typeof window !== "undefined" ? localStorage.getItem("alpha-theme") : null;
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha-theme", theme);
    }
  }, [theme]);

  const endpoint = useMemo(() => {
    if (mode === "dashboard") return "/api/prices";
    if (mode === "screener") return "/api/screener";
    if (mode === "gold") return "/api/gold";
    if (mode === "fuel") return "/api/fuel";
    return null;
  }, [mode]);

  const palette = useMemo(() => getPalette(theme), [theme]);
  const styles = useMemo(() => createStyles(palette), [palette]);

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
        const raw = Array.isArray(data) ? data : [];
        setFuelItems(sortFuelItems(raw));
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

  const topBuyCount = items.filter((x) => x.signal_action === "BUY").length;
  const topHoldCount = items.filter((x) => x.signal_action === "HOLD").length;
  const avgScore =
    items.length > 0
      ? (
          items.reduce((sum, x) => sum + Number(x.total_score || 0), 0) / items.length
        ).toFixed(1)
      : "-";

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow1} />
      <div style={styles.bgGlow2} />

      <div style={styles.container}>
        <section style={styles.heroCard}>
          <div style={styles.heroLeft}>
            <div style={styles.eyebrow}>Hệ điều hành đầu tư cá nhân</div>
            <h1 style={styles.heroTitle}>🚀 AlphaPulse Elite</h1>
            <div style={styles.heroSubtitle}>
              Trung tâm điều khiển cổ phiếu, vàng và xăng dầu với tín hiệu giao dịch
              chuyên sâu, vùng mua, cắt lỗ, chốt lời và nhịp thị trường theo thời gian thực.
            </div>

            <div style={styles.heroStats}>
              <StatPill label="BUY" value={topBuyCount} tone="green" theme={theme} />
              <StatPill label="HOLD" value={topHoldCount} tone="blue" theme={theme} />
              <StatPill label="Score TB" value={avgScore} tone="dark" theme={theme} />
            </div>
          </div>

          <div style={styles.heroRight}>
            <div style={styles.topActionRow}>
              <button
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                style={styles.themeBtn}
              >
                {theme === "light" ? "🌙 Giao diện tối" : "☀️ Giao diện sáng"}
              </button>
            </div>

            <div style={styles.statusCard}>
              <div style={styles.statusBlock}>
                <div style={styles.statusLabel}>Dữ liệu thị trường mới nhất</div>
                <div style={styles.statusValue}>
                  {formatDateTime(status?.last_updated) || "Chưa có dữ liệu"}
                </div>
              </div>

              <div style={styles.statusDivider} />

              <div style={styles.statusBlock}>
                <div style={styles.statusLabel}>GitHub update chạy lúc</div>
                <div style={styles.statusValue}>
                  {formatDateTime(status?.github_update_at) || "Chưa có dữ liệu"}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div style={styles.tabs}>
          <TabButton active={mode === "dashboard"} onClick={() => setMode("dashboard")} label="📈 Dashboard" styles={styles} />
          <TabButton active={mode === "screener"} onClick={() => setMode("screener")} label="🧭 Screener" styles={styles} />
          <TabButton active={mode === "watchlist"} onClick={() => setMode("watchlist")} label="⭐ Watchlist" styles={styles} />
          <TabButton active={mode === "gold"} onClick={() => setMode("gold")} label="🥇 Giá vàng" styles={styles} />
          <TabButton active={mode === "fuel"} onClick={() => setMode("fuel")} label="⛽ Giá xăng" styles={styles} />
        </div>

        {mode === "watchlist" ? (
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <div style={styles.panelTitle}>⭐ Quản lý watchlist</div>
                <div style={styles.panelDesc}>
                  Thêm hoặc xóa mã để cá nhân hóa danh sách theo dõi.
                </div>
              </div>
            </div>

            <div style={styles.watchToolbar}>
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Nhập mã, ví dụ FPT"
                style={styles.input}
              />
              <button onClick={addStock} style={styles.primaryBtn}>
                Thêm mã
              </button>
            </div>

            <div style={styles.watchGrid}>
              {stocks.length === 0 ? (
                <div style={styles.emptyInline}>Chưa có mã nào trong watchlist.</div>
              ) : (
                stocks.map((s, idx) => (
                  <div key={`${s.symbol}-${idx}`} style={styles.watchItem}>
                    <span style={styles.watchSymbol}>{s.symbol}</span>
                    <button onClick={() => removeStock(s.symbol)} style={styles.removeBtn}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={styles.noteHint}>
              Sau khi thêm hoặc xóa mã, chạy lại workflow cập nhật để làm mới dữ liệu.
            </div>
          </section>
        ) : loading ? (
          <div style={styles.emptyCard}>Đang tải dữ liệu...</div>
        ) : mode === "gold" ? (
          goldItems.length === 0 ? (
            <div style={styles.emptyCard}>Chưa có dữ liệu giá vàng.</div>
          ) : (
            <section style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <div style={styles.panelTitle}>🥇 Bảng giá vàng nổi bật</div>
                  <div style={styles.panelDesc}>
                    Theo dõi nhanh vàng miếng SJC, vàng nhẫn 9999 và vàng thế giới.
                  </div>
                </div>
              </div>

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
                      <div style={styles.goldValue}>
                        {formatGoldValue(item.buy_price, item.unit)}
                      </div>
                      <div style={getGoldChangeStyle(item.change_buy, styles)}>
                        {formatGoldChange(item.change_buy, item.unit)}
                      </div>
                    </div>

                    <div style={styles.goldPriceCol}>
                      <div style={styles.goldValue}>
                        {formatGoldValue(item.sell_price, item.unit)}
                      </div>
                      <div style={getGoldChangeStyle(item.change_sell, styles)}>
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
            </section>
          )
        ) : mode === "fuel" ? (
          fuelItems.length === 0 ? (
            <div style={styles.emptyCard}>Chưa có dữ liệu giá xăng dầu.</div>
          ) : (
            <section style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <div style={styles.panelTitle}>⛽ Giá xăng dầu hiện tại</div>
                  <div style={styles.panelDesc}>
                    Sắp xếp ưu tiên RON95, sau đó E5/E10, rồi Diesel và Dầu hỏa.
                  </div>
                </div>
              </div>

              <div style={styles.fuelGrid}>
                {fuelItems.map((item, idx) => (
                  <div key={`${item.fuel_type}-${idx}`} style={styles.fuelCard}>
                    <div style={styles.fuelTop}>
                      <div style={styles.fuelIcon}>{getFuelIcon(item.fuel_type)}</div>
                      <div style={styles.fuelBadge}>{getFuelBadge(item.fuel_type)}</div>
                    </div>
                    <div style={styles.fuelName}>{item.fuel_type}</div>
                    <div style={styles.fuelPrice}>{formatPrice(item.price)}</div>
                    <div style={styles.fuelUnit}>{item.unit || "VND/liter"}</div>
                    <div style={styles.fuelTime}>{formatDateTime(item.effective_time)}</div>
                  </div>
                ))}
              </div>
            </section>
          )
        ) : items.length === 0 ? (
          <div style={styles.emptyCard}>Chưa có dữ liệu phù hợp.</div>
        ) : (
          <div style={styles.cardsWrap}>
            {items.map((item, idx) => {
              const f = item.fundamental || {};

              return (
                <article key={`${item.symbol}-${idx}`} style={styles.stockCard}>
                  <div style={styles.stockTop}>
                    <div>
                      <div style={styles.stockSymbol}>{item.symbol}</div>
                      {f.industry ? <div style={styles.stockMeta}>{f.industry}</div> : null}
                    </div>

                    <div style={styles.scoreCard}>
                      <div style={styles.scoreLabel}>Score</div>
                      <div style={styles.scoreValue}>{formatNum(item.total_score)}</div>
                    </div>
                  </div>

                  <div style={styles.signalBar}>
                    <span style={getActionStyle(item.signal_action, styles)}>
                      {item.signal_action || "WATCH"}
                    </span>

                    {item.signal_strength ? (
                      <span style={styles.badgeNeutral}>{item.signal_strength}</span>
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

                  <div style={styles.metricGrid}>
                    <Metric title="Giá" value={formatNum(item.close)} styles={styles} />

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
                          : palette.textStrong
                      }
                      styles={styles}
                    />

                    <Metric
                      title="MA"
                      value={`20: ${formatNum(item.ma20)}`}
                      sub={`50: ${formatNum(item.ma50)} · 100: ${formatNum(item.ma100)}`}
                      styles={styles}
                    />

                    <Metric
                      title="MACD"
                      value={formatNum(item.macd)}
                      sub={`Signal: ${formatNum(item.macd_signal)}`}
                      color={Number(item.macd || 0) >= 0 ? "#16a34a" : "#dc2626"}
                      styles={styles}
                    />

                    <Metric
                      title="Volume"
                      value={formatNum(item.volume_ratio)}
                      sub={`MA20: ${formatNum(item.volume_ma20)}`}
                      styles={styles}
                    />

                    <Metric
                      title="Breakout"
                      value={item.breakout_55 ? "55 phiên" : item.breakout_20 ? "20 phiên" : "-"}
                      sub={`Cách MA20: ${formatNum(item.distance_ma20)}%`}
                      styles={styles}
                    />
                  </div>

                  <div style={styles.badgesRow}>
                    {item.bullish_ma ? <span style={styles.badgeGreen}>MA+</span> : null}
                    {item.bullish_macd ? <span style={styles.badgeBlue}>MACD+</span> : null}
                    {item.breakout_20 ? <span style={styles.badgeOrange}>BO20</span> : null}
                    {item.breakout_55 ? <span style={styles.badgeRed}>BO55</span> : null}
                    {item.price_action && item.price_action !== "neutral" ? (
                      <span style={styles.badgeNeutral}>{item.price_action}</span>
                    ) : null}
                  </div>

                  <div style={styles.tradeBox}>
                    <div style={styles.boxTitle}>Kế hoạch giao dịch</div>
                    <div style={styles.tradeGrid}>
                      <TradeField label="Điểm vào" value={formatNum(item.entry_price)} styles={styles} />
                      <TradeField
                        label="Vùng mua"
                        value={
                          item.entry_zone_low != null && item.entry_zone_high != null
                            ? `${formatNum(item.entry_zone_low)} - ${formatNum(item.entry_zone_high)}`
                            : "-"
                        }
                        styles={styles}
                      />
                      <TradeField label="SL" value={formatNum(item.stop_loss)} styles={styles} />
                      <TradeField label="TP1" value={formatNum(item.take_profit_1)} styles={styles} />
                      <TradeField label="TP2" value={formatNum(item.take_profit_2)} styles={styles} />
                      <TradeField label="Trailing" value={formatNum(item.trailing_stop)} styles={styles} />
                      <TradeField label="R/R" value={formatNum(item.risk_reward_ratio)} styles={styles} />
                      <TradeField
                        label="Tỷ trọng"
                        value={item.position_size_pct != null ? `${formatNum(item.position_size_pct)}%` : "-"}
                        styles={styles}
                      />
                    </div>
                  </div>

                  {item.expert_strategy_note ? (
                    <div style={styles.noteBox}>
                      <div style={styles.boxTitle}>Nhận định chuyên gia</div>
                      <div style={styles.noteText}>{item.expert_strategy_note}</div>
                    </div>
                  ) : item.expert_note ? (
                    <div style={styles.noteBox}>
                      <div style={styles.boxTitle}>Nhận định</div>
                      <div style={styles.noteText}>{item.expert_note}</div>
                    </div>
                  ) : null}

                  {f.pe != null || f.pb != null || f.roe != null ? (
                    <div style={styles.fundBox}>
                      <div style={styles.boxTitle}>Cơ bản</div>
                      <div style={styles.fundRow}>
                        <span>PE: {formatNum(f.pe)}</span>
                        <span>PB: {formatNum(f.pb)}</span>
                        <span>ROE: {formatNum(f.roe)}</span>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, styles }) {
  return (
    <button onClick={onClick} style={active ? styles.tabActive : styles.tab}>
      {label}
    </button>
  );
}

function StatPill({ label, value, tone, theme }) {
  const toneStyles = {
    green:
      theme === "dark"
        ? { background: "rgba(34,197,94,0.18)", color: "#4ade80" }
        : { background: "#dcfce7", color: "#166534" },
    blue:
      theme === "dark"
        ? { background: "rgba(59,130,246,0.18)", color: "#60a5fa" }
        : { background: "#dbeafe", color: "#1d4ed8" },
    dark:
      theme === "dark"
        ? { background: "rgba(148,163,184,0.14)", color: "#e2e8f0" }
        : { background: "#e2e8f0", color: "#0f172a" },
  };

  return (
    <div style={{ ...baseStyles.statPill, ...toneStyles[tone] }}>
      <div style={baseStyles.statLabel}>{label}</div>
      <div style={baseStyles.statValue}>{value}</div>
    </div>
  );
}

function Metric({ title, value, sub, color, styles }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: color || styles.metricValue.color }}>{value}</div>
      {sub ? <div style={styles.metricSub}>{sub}</div> : null}
    </div>
  );
}

function TradeField({ label, value, styles }) {
  return (
    <div style={styles.tradeField}>
      <div style={styles.tradeLabel}>{label}</div>
      <div style={styles.tradeValue}>{value}</div>
    </div>
  );
}

function sortFuelItems(items) {
  const order = [
    "RON95-V",
    "RON95-III",
    "E5 RON92-II",
    "E10 RON95-III",
    "Diesel 0.001S-V",
    "Diesel 0.05S-II",
    "Dầu hỏa 2-K",
  ];

  return [...items].sort((a, b) => {
    const ia = order.indexOf(a.fuel_type);
    const ib = order.indexOf(b.fuel_type);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

function getFuelIcon(name) {
  if (name.includes("RON95")) return "🏎️";
  if (name.includes("E5") || name.includes("E10")) return "🚗";
  if (name.includes("Diesel")) return "🚛";
  if (name.includes("Dầu hỏa")) return "🛢️";
  return "⛽";
}

function getFuelBadge(name) {
  if (name.includes("RON95")) return "Premium";
  if (name.includes("E5") || name.includes("E10")) return "Eco";
  if (name.includes("Diesel")) return "Diesel";
  if (name.includes("Dầu hỏa")) return "Kerosene";
  return "Fuel";
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
    const sign = Number(value) > 0 ? "+" : "-";
    return `${sign}${(Math.abs(Number(value)) / 1_000_000).toFixed(1)}M`;
  }

  const sign = Number(value) > 0 ? "+" : "-";
  return `${sign}${Math.abs(Number(value)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getGoldChangeStyle(change, styles) {
  return change == null
    ? styles.goldChangeNeutral
    : Number(change) >= 0
    ? styles.goldChangeUp
    : styles.goldChangeDown;
}

function getActionStyle(action, styles) {
  if (action === "BUY") return styles.actionBuy;
  if (action === "HOLD") return styles.actionHold;
  if (action === "TAKE_PROFIT") return styles.actionTp;
  if (action === "SELL" || action === "CUT_LOSS") return styles.actionSell;
  return styles.actionWatch;
}

function getPalette(theme) {
  if (theme === "dark") {
    return {
      bg:
        "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 28%), radial-gradient(circle at top right, rgba(16,185,129,0.16), transparent 24%), #020617",
      glow1: "rgba(59,130,246,0.14)",
      glow2: "rgba(16,185,129,0.14)",
      panel: "rgba(15,23,42,0.78)",
      panelBorder: "rgba(148,163,184,0.16)",
      textStrong: "#f8fafc",
      text: "#e2e8f0",
      textSoft: "#94a3b8",
      surface: "#0f172a",
      surfaceAlt: "#111827",
      metric: "#111827",
      line: "#1f2937",
      shadow: "rgba(2,6,23,0.42)",
      btn: "#e2e8f0",
      btnText: "#0f172a",
      tab: "rgba(15,23,42,0.8)",
      tabText: "#e2e8f0",
      card: "rgba(15,23,42,0.80)",
      lightSurface: "#0f172a",
    };
  }

  return {
    bg:
      "radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 28%), radial-gradient(circle at top right, rgba(16,185,129,0.10), transparent 24%), #eef2f7",
    glow1: "rgba(59,130,246,0.10)",
    glow2: "rgba(16,185,129,0.10)",
    panel: "rgba(255,255,255,0.82)",
    panelBorder: "rgba(255,255,255,0.65)",
    textStrong: "#0f172a",
    text: "#334155",
    textSoft: "#64748b",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    metric: "#f8fafc",
    line: "#e2e8f0",
    shadow: "rgba(15,23,42,0.08)",
    btn: "#0f172a",
    btnText: "#ffffff",
    tab: "rgba(255,255,255,0.85)",
    tabText: "#0f172a",
    card: "rgba(255,255,255,0.82)",
    lightSurface: "#ffffff",
  };
}

const baseStyles = {
  statPill: {
    minWidth: 98,
    padding: "10px 14px",
    borderRadius: 16,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 700,
    opacity: 0.8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 900,
  },
};

function createStyles(p) {
  return {
    page: {
      minHeight: "100vh",
      background: p.bg,
      padding: 14,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: "relative",
      overflowX: "hidden",
    },
    bgGlow1: {
      position: "fixed",
      width: 280,
      height: 280,
      borderRadius: "50%",
      background: p.glow1,
      filter: "blur(90px)",
      top: -80,
      left: -80,
      pointerEvents: "none",
    },
    bgGlow2: {
      position: "fixed",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: p.glow2,
      filter: "blur(90px)",
      top: 120,
      right: -80,
      pointerEvents: "none",
    },
    container: {
      maxWidth: 1120,
      margin: "0 auto",
      position: "relative",
      zIndex: 1,
    },
    heroCard: {
      display: "flex",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
      padding: 18,
      borderRadius: 24,
      background: p.panel,
      backdropFilter: "blur(14px)",
      boxShadow: `0 20px 50px ${p.shadow}`,
      border: `1px solid ${p.panelBorder}`,
      marginBottom: 16,
    },
    heroLeft: {
      flex: 1,
      minWidth: 240,
    },
    heroRight: {
      width: 320,
      maxWidth: "100%",
    },
    eyebrow: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 1.3,
      color: p.textSoft,
      fontWeight: 800,
      marginBottom: 10,
    },
    heroTitle: {
      margin: 0,
      fontSize: 34,
      lineHeight: 1.05,
      color: p.textStrong,
      fontWeight: 900,
    },
    heroSubtitle: {
      marginTop: 10,
      fontSize: 14,
      lineHeight: 1.7,
      color: p.textSoft,
      maxWidth: 700,
    },
    heroStats: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 18,
    },
    topActionRow: {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: 10,
    },
    themeBtn: {
      border: "none",
      background: p.btn,
      color: p.btnText,
      padding: "10px 14px",
      borderRadius: 14,
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: `0 10px 24px ${p.shadow}`,
      width: "100%",
    },
    statusCard: {
      padding: 16,
      borderRadius: 20,
      background: p.surface,
      boxShadow: `0 16px 40px ${p.shadow}`,
      border: `1px solid ${p.line}`,
    },
    statusBlock: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
    },
    statusDivider: {
      height: 1,
      background: p.line,
      margin: "12px 0",
    },
    statusLabel: {
      fontSize: 12,
      color: p.textSoft,
      fontWeight: 700,
    },
    statusValue: {
      fontSize: 14,
      color: p.textStrong,
      fontWeight: 800,
      lineHeight: 1.5,
    },
    tabs: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 16,
    },
    tab: {
      border: `1px solid ${p.line}`,
      background: p.tab,
      color: p.tabText,
      padding: "10px 14px",
      borderRadius: 14,
      cursor: "pointer",
      fontWeight: 800,
      fontSize: 13,
      boxShadow: `0 6px 16px ${p.shadow}`,
    },
    tabActive: {
      border: "1px solid transparent",
      background: "linear-gradient(135deg, #2563eb, #0f172a)",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: 14,
      cursor: "pointer",
      fontWeight: 800,
      fontSize: 13,
      boxShadow: `0 12px 28px ${p.shadow}`,
    },
    panel: {
      background: p.panel,
      backdropFilter: "blur(12px)",
      borderRadius: 22,
      padding: 16,
      boxShadow: `0 20px 50px ${p.shadow}`,
      border: `1px solid ${p.panelBorder}`,
      marginBottom: 16,
    },
    panelHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 14,
      flexWrap: "wrap",
    },
    panelTitle: {
      fontSize: 20,
      fontWeight: 900,
      color: p.textStrong,
      marginBottom: 6,
    },
    panelDesc: {
      color: p.textSoft,
      fontSize: 13,
      lineHeight: 1.6,
    },
    watchToolbar: {
      display: "flex",
      gap: 10,
      marginBottom: 14,
      flexWrap: "wrap",
    },
    input: {
      flex: 1,
      minWidth: 220,
      padding: 14,
      borderRadius: 14,
      border: `1px solid ${p.line}`,
      fontSize: 14,
      background: p.surface,
      color: p.textStrong,
      outline: "none",
    },
    primaryBtn: {
      padding: "14px 18px",
      borderRadius: 14,
      border: "none",
      background: "linear-gradient(135deg, #2563eb, #0f172a)",
      color: "#fff",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: `0 12px 28px ${p.shadow}`,
    },
    watchGrid: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
    },
    watchItem: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: p.theme === "dark" ? "#172554" : "#eff6ff",
      color: p.theme === "dark" ? "#93c5fd" : "#1d4ed8",
      padding: "10px 14px",
      borderRadius: 999,
      fontWeight: 800,
    },
    watchSymbol: {
      lineHeight: 1,
    },
    removeBtn: {
      border: "none",
      background: "transparent",
      color: "#dc2626",
      fontSize: 18,
      fontWeight: 900,
      cursor: "pointer",
      lineHeight: 1,
    },
    noteHint: {
      marginTop: 12,
      fontSize: 12,
      color: p.textSoft,
    },
    emptyCard: {
      background: p.panel,
      borderRadius: 22,
      padding: 26,
      color: p.textSoft,
      textAlign: "center",
      boxShadow: `0 20px 50px ${p.shadow}`,
    },
    emptyInline: {
      color: p.textSoft,
      fontSize: 14,
    },
    cardsWrap: {
      display: "grid",
      gap: 14,
    },
    stockCard: {
      background: p.card,
      backdropFilter: "blur(12px)",
      borderRadius: 22,
      padding: 16,
      boxShadow: `0 20px 50px ${p.shadow}`,
      border: `1px solid ${p.panelBorder}`,
    },
    stockTop: {
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
      flexWrap: "wrap",
    },
    stockSymbol: {
      fontSize: 26,
      fontWeight: 900,
      color: p.textStrong,
    },
    stockMeta: {
      marginTop: 6,
      fontSize: 13,
      color: p.textSoft,
    },
    scoreCard: {
      padding: "10px 14px",
      minWidth: 92,
      borderRadius: 18,
      background: p.surfaceAlt,
      border: `1px solid ${p.line}`,
      textAlign: "right",
    },
    scoreLabel: {
      fontSize: 11,
      color: p.textSoft,
      fontWeight: 700,
    },
    scoreValue: {
      fontSize: 28,
      fontWeight: 900,
      color: p.textStrong,
    },
    signalBar: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 14,
    },
    actionBuy: {
      background: "#dcfce7",
      color: "#166534",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    actionHold: {
      background: "#dbeafe",
      color: "#1d4ed8",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    actionWatch: {
      background: "#fef3c7",
      color: "#92400e",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    actionTp: {
      background: "#ffedd5",
      color: "#c2410c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    actionSell: {
      background: "#fee2e2",
      color: "#b91c1c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    badgeGreen: {
      background: "#dcfce7",
      color: "#166534",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    badgeBlue: {
      background: "#dbeafe",
      color: "#1d4ed8",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    badgeOrange: {
      background: "#ffedd5",
      color: "#c2410c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    badgeRed: {
      background: "#fee2e2",
      color: "#b91c1c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    badgeNeutral: {
      background: p.theme === "dark" ? "#1e293b" : "#f1f5f9",
      color: p.theme === "dark" ? "#cbd5e1" : "#334155",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
    },
    metricGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: 10,
    },
    metricCard: {
      background: p.metric,
      borderRadius: 16,
      padding: 14,
      border: `1px solid ${p.line}`,
    },
    metricTitle: {
      fontSize: 12,
      color: p.textSoft,
      fontWeight: 700,
      marginBottom: 8,
    },
    metricValue: {
      fontSize: 26,
      fontWeight: 900,
      lineHeight: 1.1,
      color: p.textStrong,
    },
    metricSub: {
      marginTop: 6,
      fontSize: 12,
      color: p.textSoft,
      lineHeight: 1.5,
    },
    badgesRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 14,
    },
    tradeBox: {
      marginTop: 14,
      background:
        p.textStrong === "#f8fafc"
          ? "linear-gradient(180deg, rgba(30,41,59,0.9), rgba(15,23,42,0.9))"
          : "linear-gradient(180deg, #eff6ff, #f8fbff)",
      borderRadius: 18,
      padding: 14,
      border: `1px solid ${p.line}`,
    },
    boxTitle: {
      fontSize: 13,
      fontWeight: 800,
      color: p.textStrong,
      marginBottom: 10,
    },
    tradeGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
      gap: 10,
    },
    tradeField: {
      background: p.surface,
      borderRadius: 14,
      padding: 12,
      border: `1px solid ${p.line}`,
    },
    tradeLabel: {
      fontSize: 12,
      color: p.textSoft,
      marginBottom: 6,
      fontWeight: 700,
    },
    tradeValue: {
      fontSize: 16,
      fontWeight: 800,
      color: p.textStrong,
    },
    noteBox: {
      marginTop: 14,
      background: p.surfaceAlt,
      borderRadius: 18,
      padding: 14,
      border: `1px solid ${p.line}`,
    },
    noteText: {
      fontSize: 14,
      color: p.textStrong,
      lineHeight: 1.65,
    },
    fundBox: {
      marginTop: 14,
      background: p.surfaceAlt,
      borderRadius: 18,
      padding: 14,
      border: `1px solid ${p.line}`,
    },
    fundRow: {
      display: "flex",
      gap: 14,
      flexWrap: "wrap",
      color: p.textStrong,
      fontWeight: 700,
      fontSize: 13,
    },
    goldBoard: {
      background: p.surface,
      borderRadius: 22,
      padding: 16,
      border: `1px solid ${p.line}`,
      boxShadow: `0 16px 40px ${p.shadow}`,
    },
    goldHeaderRow: {
      display: "grid",
      gridTemplateColumns: "1.25fr 1fr 1fr",
      gap: 10,
      marginBottom: 14,
      color: p.textSoft,
      fontWeight: 800,
      fontSize: 14,
    },
    goldHeaderName: {},
    goldHeaderPrice: {
      textAlign: "right",
    },
    goldRow: {
      display: "grid",
      gridTemplateColumns: "1.25fr 1fr 1fr",
      gap: 10,
      padding: "16px 0",
      borderTop: `1px solid ${p.line}`,
    },
    goldNameCol: {},
    goldName: {
      fontSize: 22,
      fontWeight: 900,
      color: p.textStrong,
      lineHeight: 1.2,
    },
    goldSubtitle: {
      marginTop: 8,
      fontSize: 14,
      color: p.textSoft,
    },
    goldPriceCol: {
      textAlign: "right",
    },
    goldValue: {
      fontSize: 26,
      fontWeight: 900,
      color: p.textStrong,
    },
    goldChangeUp: {
      marginTop: 6,
      fontSize: 16,
      fontWeight: 800,
      color: "#16a34a",
    },
    goldChangeDown: {
      marginTop: 6,
      fontSize: 16,
      fontWeight: 800,
      color: "#dc2626",
    },
    goldChangeNeutral: {
      marginTop: 6,
      fontSize: 16,
      fontWeight: 800,
      color: p.textSoft,
    },
    goldFooter: {
      marginTop: 14,
      paddingTop: 14,
      borderTop: `1px solid ${p.line}`,
      color: p.textSoft,
      fontSize: 13,
    },
    fuelGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 12,
    },
    fuelCard: {
      background:
        p.textStrong === "#f8fafc"
          ? "linear-gradient(135deg, #0f172a, #111827)"
          : "linear-gradient(135deg, #ffffff, #f8fbff)",
      borderRadius: 20,
      padding: 16,
      border: `1px solid ${p.line}`,
      boxShadow: `0 16px 40px ${p.shadow}`,
    },
    fuelTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    fuelIcon: {
      fontSize: 24,
    },
    fuelBadge: {
      display: "inline-block",
      padding: "5px 9px",
      borderRadius: 999,
      background: p.textStrong === "#f8fafc" ? "rgba(59,130,246,0.18)" : "#eef2ff",
      color: p.textStrong === "#f8fafc" ? "#93c5fd" : "#4338ca",
      fontSize: 11,
      fontWeight: 800,
    },
    fuelName: {
      fontSize: 18,
      fontWeight: 900,
      color: p.textStrong,
      marginBottom: 10,
      lineHeight: 1.3,
    },
    fuelPrice: {
      fontSize: 28,
      fontWeight: 900,
      color: "#16a34a",
      lineHeight: 1.1,
    },
    fuelUnit: {
      marginTop: 6,
      fontSize: 13,
      color: p.textSoft,
    },
    fuelTime: {
      marginTop: 10,
      fontSize: 12,
      color: p.textSoft,
      lineHeight: 1.5,
    },
  };
}
