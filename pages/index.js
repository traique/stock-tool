import { useEffect, useMemo, useState } from "react";

const TABS = [
  { key: "stocks", label: "📈 Cổ phiếu" },
  { key: "screener", label: "🧭 Screener" },
  { key: "watchlist", label: "⭐ Watchlist" },
  { key: "gold", label: "🥇 Giá vàng" },
  { key: "fuel", label: "⛽ Giá xăng" },
];

export default function Home() {
  const [mode, setMode] = useState("stocks");
  const [theme, setTheme] = useState("light");
  const [items, setItems] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [goldItems, setGoldItems] = useState([]);
  const [fuelItems, setFuelItems] = useState([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobRunning, setJobRunning] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("alpha-theme") : null;
    if (saved === "dark" || saved === "light") setTheme(saved);

    const checkMobile = () => setIsMobile(window.innerWidth <= 820);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha-theme", theme);
    }
  }, [theme]);

  const endpoint = useMemo(() => {
    if (mode === "stocks") return "/api/prices";
    if (mode === "screener") return "/api/screener";
    if (mode === "gold") return "/api/gold";
    if (mode === "fuel") return "/api/fuel";
    return null;
  }, [mode]);

  const palette = useMemo(() => getPalette(theme), [theme]);
  const styles = useMemo(() => createStyles(palette, isMobile), [palette, isMobile]);

  const latestGoldSourceTime = useMemo(() => getLatestDateValue(goldItems, "price_time"), [goldItems]);
  const latestGoldSyncTime = useMemo(
    () => getLatestDateValue(goldItems, "created_at") || getLatestDateValue(goldItems, "price_time"),
    [goldItems]
  );

  const latestFuelTime = useMemo(() => getLatestDateValue(fuelItems, "effective_time"), [fuelItems]);
  const latestStockTime = useMemo(() => status?.last_updated || null, [status]);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data || null);
    } catch {
      setStatus(null);
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

  const loadData = async () => {
    if (!endpoint) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(endpoint);
      const data = await res.json();

      if (mode === "gold") setGoldItems(Array.isArray(data) ? data : []);
      else if (mode === "fuel") setFuelItems(sortFuelItems(Array.isArray(data) ? data : []));
      else setItems(Array.isArray(data) ? data : []);
    } catch {
      if (mode === "gold") setGoldItems([]);
      else if (mode === "fuel") setFuelItems([]);
      else setItems([]);
    } finally {
      setLoading(false);
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

  const pollJob = async (jobId) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status?id=${jobId}`);
        const data = await res.json();
        setJobStatus(data);
        if (data?.status === "success" || data?.status === "failed") {
          clearInterval(timer);
          setJobRunning(false);
          await loadData();
          await loadStatus();
        }
      } catch {
        clearInterval(timer);
        setJobRunning(false);
      }
    }, 2500);
  };

  const runUpdate = async (target) => {
    try {
      setJobRunning(true);
      setJobStatus({
        target,
        status: "queued",
        progress: 8,
        message: "Đang gửi lệnh cập nhật...",
      });

      const res = await fetch("/api/run-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });

      const data = await res.json();
      if (!res.ok) {
        setJobRunning(false);
        setJobStatus({
          target,
          status: "failed",
          progress: 100,
          message: data.github_response || data.detail || data.error || "Không gọi được workflow",
        });
        return;
      }
      await pollJob(data.job_run_id);
    } catch {
      setJobRunning(false);
      setJobStatus({ status: "failed", progress: 100, message: "Lỗi khi gửi lệnh chạy" });
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.auroraOne} />
      <div style={styles.auroraTwo} />

      <div style={styles.shell}>
        <section style={styles.heroGrid}>
          <div style={{ ...styles.card, ...styles.heroMain }}>
            <div style={styles.heroTopline}>LCTA • Dashboard đầu tư cá nhân</div>
            <h1 style={styles.heroTitle}>AlphaPulse Elite</h1>
            <p style={styles.heroDesc}>
              Giao diện Bento Grid hiện đại cho cổ phiếu, vàng và xăng dầu. Tập trung vào dữ liệu quan trọng,
              ít rối mắt, dễ xem trên mobile.
            </p>

            <div style={styles.tabWrap}>
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setMode(tab.key)}
                  style={mode === tab.key ? styles.tabActive : styles.tab}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...styles.card, ...styles.heroSide }}>
            <div style={styles.miniLabel}>Giao diện</div>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              style={styles.themeToggle}
              aria-label="Đổi giao diện"
            >
              <span style={styles.themeIcon}>{theme === "light" ? "🌙" : "☀️"}</span>
              <span style={styles.themeText}>{theme === "light" ? "Dark mode" : "Light mode"}</span>
            </button>
          </div>

          <StatCard
            styles={styles}
            title="Cập nhật thị trường"
            value={formatDateTime(latestStockTime) || "Chưa có dữ liệu"}
          />
          <StatCard
            styles={styles}
            title="Giá vàng mới nhất"
            value={formatDateTime(latestGoldSourceTime) || "Chưa có dữ liệu"}
          />
          <StatCard
            styles={styles}
            title="Giá xăng hiệu lực"
            value={formatDateTime(latestFuelTime) || "Chưa có dữ liệu"}
          />
        </section>

        {mode === "watchlist" ? (
          <section style={styles.card}>
            <SectionHeader
              styles={styles}
              title="Watchlist cá nhân"
              desc="Quản lý nhanh các mã bạn đang muốn theo dõi."
            />

            <div style={styles.watchInputRow}>
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Nhập mã cổ phiếu, ví dụ FPT"
                style={styles.input}
              />
              <button onClick={addStock} style={styles.primaryButton}>Thêm mã</button>
            </div>

            <div style={styles.watchChips}>
              {stocks.length === 0 ? (
                <EmptyState styles={styles} text="Chưa có mã nào trong watchlist." />
              ) : (
                stocks.map((s, idx) => (
                  <div key={`${s.symbol}-${idx}`} style={styles.watchChip}>
                    <span>{s.symbol}</span>
                    <button onClick={() => removeStock(s.symbol)} style={styles.removeButton}>×</button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : loading ? (
          <EmptyPanel styles={styles} text="Đang tải dữ liệu..." />
        ) : mode === "gold" ? (
          goldItems.length === 0 ? (
            <EmptyPanel styles={styles} text="Chưa có dữ liệu giá vàng." />
          ) : (
            <section style={styles.gridTwo}>
              <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
                <SectionHeader
                  styles={styles}
                  title="Giá vàng hôm nay"
                  desc="Bố cục gọn hơn, nhấn mạnh giá và thay đổi gần nhất."
                />
              </div>

              {goldItems.map((item, idx) => {
                const isWorldGold =
                  item.gold_type === "world_xauusd" || String(item.subtitle || "").toUpperCase() === "XAU/USD";
                return (
                  <article key={`${item.gold_type}-${idx}`} style={styles.card}>
                    <div style={styles.rowBetweenTop}>
                      <div>
                        <div style={styles.cardTitle}>{item.display_name || item.gold_type}</div>
                        <div style={styles.muted}>{item.subtitle || item.source}</div>
                      </div>
                      <div style={styles.softPill}>{isWorldGold ? "Global" : "Domestic"}</div>
                    </div>

                    {isWorldGold ? (
                      <div style={styles.singlePriceBox}>
                        <div style={styles.label}>Giá hiện tại</div>
                        <div style={styles.bigNumber}>{formatGoldValue(item.buy_price, item.unit)}</div>
                        <div style={getGoldChangeStyle(item.change_buy, styles, item.unit)}>
                          {formatGoldChange(item.change_buy, item.unit) || "Không đổi"}
                        </div>
                      </div>
                    ) : (
                      <div style={styles.dualGrid}>
                        <ValueBox
                          styles={styles}
                          label="Mua vào"
                          value={formatGoldValue(item.buy_price, item.unit)}
                          change={formatGoldChange(item.change_buy, item.unit)}
                          changeStyle={getGoldChangeStyle(item.change_buy, styles, item.unit)}
                        />
                        <ValueBox
                          styles={styles}
                          label="Bán ra"
                          value={formatGoldValue(item.sell_price, item.unit)}
                          change={formatGoldChange(item.change_sell, item.unit)}
                          changeStyle={getGoldChangeStyle(item.change_sell, styles, item.unit)}
                        />
                      </div>
                    )}

                    <div style={styles.bottomMeta}>{formatDateTime(item.price_time) || "Chưa có dữ liệu"}</div>
                  </article>
                );
              })}

              <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
                <div style={styles.footerMetaGrid}>
                  <MetaLine styles={styles} label="Giá từ nguồn" value={formatDateTime(latestGoldSourceTime)} />
                  <MetaLine styles={styles} label="Hệ thống đồng bộ" value={formatDateTime(latestGoldSyncTime)} />
                </div>
              </div>
            </section>
          )
        ) : mode === "fuel" ? (
          fuelItems.length === 0 ? (
            <EmptyPanel styles={styles} text="Chưa có dữ liệu giá xăng dầu." />
          ) : (
            <section style={styles.gridThree}>
              <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
                <SectionHeader
                  styles={styles}
                  title="Giá xăng dầu hiện tại"
                  desc="Sắp xếp ưu tiên RON95, rồi E5/E10, Diesel và Dầu hỏa."
                />
              </div>
              {fuelItems.map((item, idx) => (
                <article key={`${item.fuel_type}-${idx}`} style={styles.card}>
                  <div style={styles.rowBetweenTop}>
                    <div style={styles.fuelIcon}>{getFuelIcon(item.fuel_type)}</div>
                    <div style={styles.softPill}>{getFuelBadge(item.fuel_type)}</div>
                  </div>
                  <div style={styles.cardTitle}>{item.fuel_type}</div>
                  <div style={styles.bigNumberGreen}>{formatPrice(item.price)}</div>
                  <div style={styles.muted}>{item.unit || "VND/liter"}</div>
                  <div style={styles.bottomMeta}>{formatDateTime(item.effective_time)}</div>
                </article>
              ))}
            </section>
          )
        ) : items.length === 0 ? (
          <EmptyPanel styles={styles} text="Chưa có dữ liệu phù hợp." />
        ) : (
          <section style={styles.stockList}>
            <div style={styles.card}>
              <SectionHeader
                styles={styles}
                title={mode === "stocks" ? "Bảng cổ phiếu" : "Bảng screener"}
                desc="Layout bento mới: gọn, dễ quét và ưu tiên những dữ liệu thực sự quan trọng."
              />
            </div>

            {items.map((item, idx) => {
              const f = item.fundamental || {};
              const hasTradePlan = hasTradePlanData(item);
              return (
                <article key={`${item.symbol}-${idx}`} style={styles.card}>
                  <div style={styles.stockTopGrid}>
                    <div>
                      <div style={styles.stockTitle}>{item.symbol}</div>
                      <div style={styles.muted}>{f.industry || "Chưa có ngành"}</div>
                    </div>
                    <div style={styles.scoreCard}>
                      <div style={styles.scoreLabel}>Score</div>
                      <div style={styles.scoreValue}>{formatNum(item.total_score)}</div>
                    </div>
                  </div>

                  <div style={styles.badgeRow}>
                    <span style={getActionStyle(item.signal_action, styles)}>{item.signal_action || "WATCH"}</span>
                    {item.signal_strength ? <span style={styles.softPill}>{item.signal_strength}</span> : null}
                    {item.setup_type ? <span style={styles.softPillBlue}>{item.setup_type}</span> : null}
                    {item.confidence_score != null ? (
                      <span style={styles.softPillGreen}>Conf {formatNum(item.confidence_score)}</span>
                    ) : null}
                  </div>

                  <div style={styles.bentoGrid}>
                    <MetricBox styles={styles} title="Giá" value={formatNum(item.close)} />
                    <MetricBox
                      styles={styles}
                      title="RSI"
                      value={formatNum(item.rsi)}
                      note={item.overbought ? "Quá mua" : item.oversold ? "Quá bán" : "Trung tính"}
                    />
                    <MetricBox
                      styles={styles}
                      title="MACD"
                      value={formatNum(item.macd)}
                      note={`Signal ${formatNum(item.macd_signal)}`}
                    />
                    <MetricBox
                      styles={styles}
                      title="Volume"
                      value={formatNum(item.volume_ratio)}
                      note={`MA20 ${formatNum(item.volume_ma20)}`}
                    />
                    <MetricBox
                      styles={styles}
                      title="MA"
                      value={`20 ${formatNum(item.ma20)}`}
                      note={`50 ${formatNum(item.ma50)} · 100 ${formatNum(item.ma100)}`}
                    />
                    <MetricBox
                      styles={styles}
                      title="Breakout"
                      value={item.breakout_55 ? "55 phiên" : item.breakout_20 ? "20 phiên" : "-"}
                      note={`MA20 ${formatNum(item.distance_ma20)}%`}
                    />
                  </div>

                  {(item.bullish_ma || item.bullish_macd || item.breakout_20 || item.breakout_55 || (item.price_action && item.price_action !== "neutral")) ? (
                    <div style={styles.badgeRow}>
                      {item.bullish_ma ? <span style={styles.softPillGreen}>MA+</span> : null}
                      {item.bullish_macd ? <span style={styles.softPillBlue}>MACD+</span> : null}
                      {item.breakout_20 ? <span style={styles.softPillOrange}>BO20</span> : null}
                      {item.breakout_55 ? <span style={styles.softPillRed}>BO55</span> : null}
                      {item.price_action && item.price_action !== "neutral" ? <span style={styles.softPill}>{item.price_action}</span> : null}
                    </div>
                  ) : null}

                  {hasTradePlan ? (
                    <div style={styles.subCard}>
                      <div style={styles.subCardTitle}>Kế hoạch giao dịch</div>
                      <div style={styles.planGrid}>
                        <MetricBox styles={styles} title="Điểm vào" value={formatNum(item.entry_price)} compact />
                        <MetricBox
                          styles={styles}
                          title="Vùng mua"
                          value={
                            item.entry_zone_low != null && item.entry_zone_high != null
                              ? `${formatNum(item.entry_zone_low)} - ${formatNum(item.entry_zone_high)}`
                              : "-"
                          }
                          compact
                        />
                        <MetricBox styles={styles} title="SL" value={formatNum(item.stop_loss)} compact />
                        <MetricBox styles={styles} title="TP1" value={formatNum(item.take_profit_1)} compact />
                        <MetricBox styles={styles} title="TP2" value={formatNum(item.take_profit_2)} compact />
                        <MetricBox styles={styles} title="Trailing" value={formatNum(item.trailing_stop)} compact />
                        <MetricBox styles={styles} title="R/R" value={formatNum(item.risk_reward_ratio)} compact />
                        <MetricBox
                          styles={styles}
                          title="Tỷ trọng"
                          value={item.position_size_pct != null ? `${formatNum(item.position_size_pct)}%` : "-"}
                          compact
                        />
                      </div>
                    </div>
                  ) : null}

                  {item.expert_strategy_note || item.expert_note ? (
                    <div style={styles.subCard}>
                      <div style={styles.subCardTitle}>{item.expert_strategy_note ? "Nhận định chuyên gia" : "Nhận định"}</div>
                      <div style={styles.noteText}>{item.expert_strategy_note || item.expert_note}</div>
                    </div>
                  ) : null}

                  {f.pe != null || f.pb != null || f.roe != null ? (
                    <div style={styles.subCard}>
                      <div style={styles.subCardTitle}>Cơ bản</div>
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
          </section>
        )}

        <section style={styles.card}>
          <SectionHeader
            styles={styles}
            title="Cập nhật dữ liệu"
            desc="Giữ phần cập nhật ở cuối để giao diện chính gọn và ít rối mắt hơn."
          />

          <div style={styles.updateGrid}>
            <button style={styles.secondaryButton} onClick={() => runUpdate("stocks")} disabled={jobRunning}>
              🔄 Cập nhật cổ phiếu
            </button>
            <button style={styles.secondaryButton} onClick={() => runUpdate("gold")} disabled={jobRunning}>
              🥇 Cập nhật vàng
            </button>
            <button style={styles.secondaryButton} onClick={() => runUpdate("fuel")} disabled={jobRunning}>
              ⛽ Cập nhật xăng
            </button>
            <button style={styles.primaryButton} onClick={() => runUpdate("all")} disabled={jobRunning}>
              ⚡ Cập nhật tất cả
            </button>
          </div>

          {jobStatus ? (
            <div style={styles.progressWrap}>
              <div style={styles.rowBetweenTop}>
                <div style={styles.subCardTitle}>Tiến trình cập nhật</div>
                <div style={styles.progressText}>{Number(jobStatus.progress || 0)}%</div>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressBar, width: `${Number(jobStatus.progress || 0)}%` }} />
              </div>
              <div style={styles.noteText}>{jobStatus.message || "Đang xử lý..."}</div>
              <div style={styles.muted}>Trạng thái: {jobStatus.status || "queued"}</div>
            </div>
          ) : (
            <EmptyState styles={styles} text="Chưa có tiến trình cập nhật nào được hiển thị." />
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ styles, title, value }) {
  return (
    <div style={styles.card}>
      <div style={styles.statLabel}>{title}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function SectionHeader({ styles, title, desc }) {
  return (
    <div>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionDesc}>{desc}</div>
    </div>
  );
}

function ValueBox({ styles, label, value, change, changeStyle }) {
  return (
    <div style={styles.valueBox}>
      <div style={styles.label}>{label}</div>
      <div style={styles.valueBoxNumber}>{value}</div>
      <div style={changeStyle}>{change || "Không đổi"}</div>
    </div>
  );
}

function MetricBox({ styles, title, value, note, compact = false }) {
  return (
    <div style={compact ? styles.metricBoxCompact : styles.metricBox}>
      <div style={styles.label}>{title}</div>
      <div style={compact ? styles.metricCompactValue : styles.metricValue}>{value}</div>
      {note ? <div style={styles.metricNote}>{note}</div> : null}
    </div>
  );
}

function MetaLine({ styles, label, value }) {
  return (
    <div style={styles.metaLine}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={styles.metaValue}>{value || "Chưa có dữ liệu"}</span>
    </div>
  );
}

function EmptyPanel({ styles, text }) {
  return <div style={styles.card}>{text}</div>;
}

function EmptyState({ styles, text }) {
  return <div style={styles.muted}>{text}</div>;
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

function getFuelIcon(name = "") {
  if (name.includes("RON95")) return "🏎️";
  if (name.includes("E5") || name.includes("E10")) return "🚗";
  if (name.includes("Diesel")) return "🚛";
  if (name.includes("Dầu hỏa")) return "🛢️";
  return "⛽";
}

function getFuelBadge(name = "") {
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

function getLatestDateValue(items, field) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let latestValue = null;
  let latestMs = -Infinity;

  for (const item of items) {
    const value = item?.[field];
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestValue = value;
    }
  }
  return latestValue;
}

function formatGoldValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  if (unit === "VND/lượng") return num.toLocaleString("vi-VN");
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatGoldChange(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const num = Number(value);

  if (unit === "VND/lượng") {
    if (Math.abs(num) < 1000) return "";
    const sign = num > 0 ? "+" : "-";
    return `${sign}${Math.abs(Math.round(num)).toLocaleString("vi-VN")}`;
  }

  if (Math.abs(num) < 0.01) return "";
  const sign = num > 0 ? "+" : "-";
  return `${sign}${Math.abs(num).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getGoldChangeStyle(change, styles, unit) {
  if (change == null || Number.isNaN(Number(change))) return styles.changeNeutral;
  const num = Number(change);
  if (unit === "VND/lượng" && Math.abs(num) < 1000) return styles.changeNeutral;
  if (unit !== "VND/lượng" && Math.abs(num) < 0.01) return styles.changeNeutral;
  return num >= 0 ? styles.changeUp : styles.changeDown;
}

function getActionStyle(action, styles) {
  if (action === "BUY") return styles.actionBuy;
  if (action === "HOLD") return styles.actionHold;
  if (action === "TAKE_PROFIT") return styles.actionTp;
  if (action === "SELL" || action === "CUT_LOSS") return styles.actionSell;
  return styles.actionWatch;
}

function hasTradePlanData(item) {
  if (!item) return false;
  return [
    item.entry_price,
    item.entry_zone_low,
    item.entry_zone_high,
    item.stop_loss,
    item.take_profit_1,
    item.take_profit_2,
    item.trailing_stop,
    item.risk_reward_ratio,
    item.position_size_pct,
  ].some((value) => value != null && !Number.isNaN(Number(value)));
}

function getPalette(theme) {
  if (theme === "dark") {
    return {
      bg: "#0a1120",
      bgSoft: "#10192e",
      card: "rgba(15, 23, 42, 0.82)",
      cardSoft: "rgba(17, 24, 39, 0.82)",
      line: "rgba(148, 163, 184, 0.16)",
      text: "#f8fafc",
      subtext: "#cbd5e1",
      muted: "#94a3b8",
      primary: "#4f46e5",
      primaryStrong: "#2563eb",
      shadow: "rgba(2, 6, 23, 0.40)",
      serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    };
  }

  return {
    bg: "#f4f7fb",
    bgSoft: "#eef3f9",
    card: "rgba(255, 255, 255, 0.88)",
    cardSoft: "rgba(248, 250, 252, 0.96)",
    line: "rgba(148, 163, 184, 0.22)",
    text: "#0f172a",
    subtext: "#334155",
    muted: "#64748b",
    primary: "#4f46e5",
    primaryStrong: "#1d4ed8",
    shadow: "rgba(15, 23, 42, 0.08)",
    serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
    sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };
}

function createStyles(p, isMobile) {
  const gridCols = isMobile ? "1fr" : "1.5fr 0.85fr 0.85fr 0.85fr";

  return {
    page: {
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${p.bg}, ${p.bgSoft})`,
      padding: isMobile ? 12 : 20,
      position: "relative",
      overflowX: "hidden",
      fontFamily: p.sans,
    },
    auroraOne: {
      position: "fixed",
      inset: "auto auto 72% -6%",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: "rgba(79, 70, 229, 0.18)",
      filter: "blur(90px)",
      pointerEvents: "none",
    },
    auroraTwo: {
      position: "fixed",
      inset: "72% -6% auto auto",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: "rgba(16, 185, 129, 0.12)",
      filter: "blur(90px)",
      pointerEvents: "none",
    },
    shell: {
      maxWidth: 1220,
      margin: "0 auto",
      position: "relative",
      zIndex: 1,
      display: "grid",
      gap: 14,
    },
    heroGrid: {
      display: "grid",
      gridTemplateColumns: gridCols,
      gap: 14,
    },
    gridTwo: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
      gap: 14,
    },
    gridThree: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
      gap: 14,
    },
    stockList: {
      display: "grid",
      gap: 14,
    },
    card: {
      background: p.card,
      border: `1px solid ${p.line}`,
      borderRadius: 28,
      padding: isMobile ? 16 : 20,
      boxShadow: `0 20px 40px ${p.shadow}`,
      backdropFilter: "blur(14px)",
      minWidth: 0,
    },
    heroMain: {
      gridColumn: isMobile ? "auto" : "1 / span 2",
      minHeight: isMobile ? "auto" : 220,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    heroSide: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    heroTopline: {
      fontSize: 12,
      lineHeight: 1.4,
      color: p.muted,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      fontWeight: 800,
      marginBottom: 10,
    },
    heroTitle: {
      margin: 0,
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 38 : 52,
      lineHeight: 1.02,
      letterSpacing: -0.8,
    },
    heroDesc: {
      margin: "12px 0 0 0",
      color: p.subtext,
      fontSize: 14,
      lineHeight: 1.7,
      maxWidth: 700,
    },
    tabWrap: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 18,
    },
    tab: {
      border: `1px solid ${p.line}`,
      background: p.cardSoft,
      color: p.text,
      padding: "11px 14px",
      borderRadius: 999,
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 700,
      boxShadow: `0 8px 18px ${p.shadow}`,
    },
    tabActive: {
      border: "1px solid transparent",
      background: `linear-gradient(135deg, ${p.primary}, ${p.primaryStrong})`,
      color: "#fff",
      padding: "11px 14px",
      borderRadius: 999,
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 800,
      boxShadow: `0 12px 22px ${p.shadow}`,
    },
    miniLabel: {
      fontSize: 12,
      lineHeight: 1.4,
      color: p.muted,
      fontWeight: 700,
    },
    themeToggle: {
      marginTop: 10,
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      borderRadius: 18,
      border: `1px solid ${p.line}`,
      background: p.cardSoft,
      color: p.text,
      padding: "12px 14px",
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 700,
    },
    themeIcon: { fontSize: 18 },
    themeText: { fontSize: 14, lineHeight: 1.5 },
    statLabel: {
      fontSize: 12,
      lineHeight: 1.4,
      color: p.muted,
      fontWeight: 700,
      marginBottom: 10,
    },
    statValue: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 20 : 24,
      lineHeight: 1.3,
      fontWeight: 700,
      wordBreak: "break-word",
    },
    sectionTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 28 : 34,
      lineHeight: 1.1,
      marginBottom: 8,
      fontWeight: 700,
    },
    sectionDesc: {
      color: p.subtext,
      fontSize: 14,
      lineHeight: 1.7,
    },
    watchInputRow: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
      gap: 10,
      marginTop: 16,
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      padding: "14px 16px",
      borderRadius: 18,
      border: `1px solid ${p.line}`,
      background: p.cardSoft,
      color: p.text,
      fontSize: 14,
      lineHeight: 1.5,
      outline: "none",
    },
    primaryButton: {
      border: "none",
      background: `linear-gradient(135deg, ${p.primary}, ${p.primaryStrong})`,
      color: "#fff",
      padding: "13px 16px",
      borderRadius: 18,
      cursor: "pointer",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 800,
      boxShadow: `0 12px 24px ${p.shadow}`,
    },
    secondaryButton: {
      border: `1px solid ${p.line}`,
      background: p.cardSoft,
      color: p.text,
      padding: "13px 16px",
      borderRadius: 18,
      cursor: "pointer",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 700,
      boxShadow: `0 8px 18px ${p.shadow}`,
    },
    watchChips: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 14,
    },
    watchChip: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      borderRadius: 999,
      padding: "10px 14px",
      background: p.cardSoft,
      color: p.text,
      border: `1px solid ${p.line}`,
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 700,
    },
    removeButton: {
      border: "none",
      background: "transparent",
      color: "#dc2626",
      cursor: "pointer",
      fontSize: 18,
      lineHeight: 1,
      fontWeight: 900,
      padding: 0,
    },
    rowBetweenTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 14,
    },
    cardTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 24 : 28,
      lineHeight: 1.15,
      fontWeight: 700,
    },
    muted: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.6,
    },
    softPill: {
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      color: p.subtext,
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
      whiteSpace: "nowrap",
    },
    softPillBlue: {
      background: "rgba(59, 130, 246, 0.12)",
      color: "#2563eb",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    softPillGreen: {
      background: "rgba(34, 197, 94, 0.12)",
      color: "#15803d",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    softPillOrange: {
      background: "rgba(249, 115, 22, 0.12)",
      color: "#c2410c",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    softPillRed: {
      background: "rgba(239, 68, 68, 0.12)",
      color: "#b91c1c",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    dualGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 10,
    },
    singlePriceBox: {
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 16,
    },
    valueBox: {
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 16,
    },
    label: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
      marginBottom: 8,
    },
    bigNumber: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 28 : 34,
      lineHeight: 1.1,
      fontWeight: 700,
      wordBreak: "break-word",
    },
    bigNumberGreen: {
      color: "#15803d",
      fontFamily: p.serif,
      fontSize: isMobile ? 28 : 34,
      lineHeight: 1.1,
      fontWeight: 700,
      wordBreak: "break-word",
    },
    valueBoxNumber: {
      color: p.text,
      fontSize: isMobile ? 20 : 24,
      lineHeight: 1.2,
      fontWeight: 800,
      wordBreak: "break-word",
    },
    changeUp: {
      marginTop: 8,
      color: "#15803d",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 800,
      minHeight: 21,
    },
    changeDown: {
      marginTop: 8,
      color: "#b91c1c",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 800,
      minHeight: 21,
    },
    changeNeutral: {
      marginTop: 8,
      color: p.muted,
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 700,
      minHeight: 21,
    },
    bottomMeta: {
      marginTop: 14,
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.6,
    },
    footerMetaGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
      gap: 10,
    },
    metaLine: {
      display: "grid",
      gap: 4,
      padding: 14,
      borderRadius: 18,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
    },
    metaLabel: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    metaValue: {
      color: p.text,
      fontSize: 14,
      lineHeight: 1.6,
      fontWeight: 700,
      wordBreak: "break-word",
    },
    fuelIcon: {
      fontSize: 26,
      lineHeight: 1,
    },
    stockTopGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
      gap: 12,
      alignItems: "start",
      marginBottom: 14,
    },
    stockTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 30 : 36,
      lineHeight: 1.05,
      fontWeight: 700,
    },
    scoreCard: {
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: "12px 14px",
      minWidth: isMobile ? 0 : 110,
      textAlign: isMobile ? "left" : "right",
    },
    scoreLabel: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    scoreValue: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 24 : 30,
      lineHeight: 1.1,
      fontWeight: 700,
      marginTop: 4,
    },
    badgeRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 14,
    },
    actionBuy: {
      background: "rgba(34, 197, 94, 0.14)",
      color: "#15803d",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionHold: {
      background: "rgba(59, 130, 246, 0.14)",
      color: "#2563eb",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionTp: {
      background: "rgba(249, 115, 22, 0.14)",
      color: "#c2410c",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionSell: {
      background: "rgba(239, 68, 68, 0.14)",
      color: "#b91c1c",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionWatch: {
      background: "rgba(245, 158, 11, 0.16)",
      color: "#92400e",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    bentoGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
      gap: 10,
    },
    metricBox: {
      borderRadius: 20,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 14,
      minWidth: 0,
    },
    metricBoxCompact: {
      borderRadius: 18,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 12,
      minWidth: 0,
    },
    metricValue: {
      color: p.text,
      fontSize: isMobile ? 18 : 20,
      lineHeight: 1.25,
      fontWeight: 800,
      wordBreak: "break-word",
    },
    metricCompactValue: {
      color: p.text,
      fontSize: 15,
      lineHeight: 1.35,
      fontWeight: 800,
      wordBreak: "break-word",
    },
    metricNote: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.6,
      marginTop: 6,
      wordBreak: "break-word",
    },
    subCard: {
      marginTop: 14,
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 14,
    },
    subCardTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: 20,
      lineHeight: 1.2,
      fontWeight: 700,
      marginBottom: 10,
    },
    planGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
      gap: 10,
    },
    noteText: {
      color: p.subtext,
      fontSize: 14,
      lineHeight: 1.75,
    },
    fundRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 14,
      color: p.text,
      fontSize: 14,
      lineHeight: 1.6,
      fontWeight: 700,
    },
    updateGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, max-content)",
      gap: 10,
      marginTop: 16,
      alignItems: "stretch",
    },
    progressWrap: {
      marginTop: 14,
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 14,
    },
    progressText: {
      color: p.primaryStrong,
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 800,
    },
    progressTrack: {
      width: "100%",
      height: 10,
      background: "rgba(148, 163, 184, 0.22)",
      borderRadius: 999,
      overflow: "hidden",
      marginBottom: 10,
    },
    progressBar: {
      height: "100%",
      borderRadius: 999,
      background: `linear-gradient(90deg, ${p.primary}, ${p.primaryStrong})`,
      transition: "width 0.35s ease",
    },
  };
}
