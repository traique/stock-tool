import { useEffect, useMemo, useState } from "react";

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
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("alpha-theme") : null;
    if (saved === "dark" || saved === "light") setTheme(saved);

    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
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
        setFuelItems(sortFuelItems(Array.isArray(data) ? data : []));
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

  const pollJob = async (jobId) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status?id=${jobId}`);
        const data = await res.json();
        setJobStatus(data);

        if (!data) return;

        if (data.status === "success" || data.status === "failed") {
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
        progress: 5,
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
          message:
            data.github_response ||
            data.detail ||
            data.error ||
            "Không gọi được workflow",
        });
        return;
      }

      await pollJob(data.job_run_id);
    } catch {
      setJobRunning(false);
      setJobStatus({
        status: "failed",
        progress: 100,
        message: "Lỗi khi gửi lệnh chạy",
      });
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.glowTop} />
      <div style={styles.glowBottom} />

      <div style={styles.container}>
        <section style={styles.heroCard}>
          <div style={styles.heroTop}>
            <div style={styles.brandBlock}>
              <div style={styles.brandEyebrow}>LCTA</div>
              <h1 style={styles.heroTitle}>🚀 AlphaPulse Elite</h1>
              <p style={styles.heroSubtitle}>
                Theo dõi cổ phiếu, vàng và xăng dầu với giao diện hiện đại, tín hiệu
                rõ ràng và khả năng cập nhật dữ liệu nhanh ngay trên điện thoại.
              </p>
            </div>

            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              style={styles.themeButton}
              aria-label="Đổi giao diện"
              title="Đổi giao diện"
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          </div>

          <div style={styles.heroStats}>
            <InfoCard
              title="Dữ liệu thị trường mới nhất"
              value={formatDateTime(status?.last_updated) || "Chưa có dữ liệu"}
              styles={styles}
            />
            <InfoCard
              title="GitHub update chạy lúc"
              value={formatDateTime(status?.github_update_at) || "Chưa có dữ liệu"}
              styles={styles}
            />
          </div>
        </section>

        <div style={styles.tabScroller}>
          <div style={styles.tabs}>
            <TabButton active={mode === "stocks"} onClick={() => setMode("stocks")} label="📈 Cổ phiếu" styles={styles} />
            <TabButton active={mode === "screener"} onClick={() => setMode("screener")} label="🧭 Screener" styles={styles} />
            <TabButton active={mode === "watchlist"} onClick={() => setMode("watchlist")} label="⭐ Watchlist" styles={styles} />
            <TabButton active={mode === "gold"} onClick={() => setMode("gold")} label="🥇 Giá vàng" styles={styles} />
            <TabButton active={mode === "fuel"} onClick={() => setMode("fuel")} label="⛽ Giá xăng" styles={styles} />
          </div>
        </div>

        {mode === "watchlist" ? (
          <section style={styles.sectionCard}>
            <SectionHeader
              title="⭐ Watchlist cá nhân"
              desc="Thêm và xóa mã theo dõi để cá nhân hóa danh mục."
              styles={styles}
            />

            <div style={styles.watchToolbar}>
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Nhập mã, ví dụ FPT"
                style={styles.input}
              />
              <button onClick={addStock} style={styles.primaryButton}>
                Thêm mã
              </button>
            </div>

            <div style={styles.watchGrid}>
              {stocks.length === 0 ? (
                <div style={styles.emptyInline}>Chưa có mã nào trong watchlist.</div>
              ) : (
                stocks.map((s, idx) => (
                  <div key={`${s.symbol}-${idx}`} style={styles.watchChip}>
                    <span>{s.symbol}</span>
                    <button onClick={() => removeStock(s.symbol)} style={styles.removeButton}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : loading ? (
          <div style={styles.emptyCard}>Đang tải dữ liệu...</div>
        ) : mode === "gold" ? (
          goldItems.length === 0 ? (
            <div style={styles.emptyCard}>Chưa có dữ liệu giá vàng.</div>
          ) : (
            <section style={styles.sectionCard}>
              <SectionHeader
                title="🥇 Bảng giá vàng nổi bật"
                desc="Theo dõi nhanh vàng miếng SJC, vàng nhẫn 9999 và vàng thế giới."
                styles={styles}
              />

              <div style={styles.goldList}>
                {goldItems.map((item, idx) => {
                  const isWorldGold =
                    item.gold_type === "world_xauusd" ||
                    String(item.subtitle || "").toUpperCase() === "XAU/USD";

                  return (
                    <div key={`${item.gold_type}-${idx}`} style={styles.goldItem}>
                      <div style={styles.goldItemTop}>
                        <div style={styles.goldTitleWrap}>
                          <div style={styles.goldName}>{item.display_name || item.gold_type}</div>
                          <div style={styles.goldSubtitle}>{item.subtitle || item.source}</div>
                        </div>
                      </div>

                      {isWorldGold ? (
                        <div style={styles.goldPriceGridSingle}>
                          <div style={styles.pricePanel}>
                            <div style={styles.priceLabel}>Giá hiện tại</div>
                            <div style={styles.priceValue}>
                              {formatGoldValue(item.buy_price, item.unit)}
                            </div>
                            <div style={getGoldChangeStyle(item.change_buy, styles, item.unit)}>
                              {formatGoldChange(item.change_buy, item.unit)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={styles.goldPriceGrid}>
                          <div style={styles.pricePanel}>
                            <div style={styles.priceLabel}>Mua vào</div>
                            <div style={styles.priceValue}>
                              {formatGoldValue(item.buy_price, item.unit)}
                            </div>
                            <div style={getGoldChangeStyle(item.change_buy, styles, item.unit)}>
                              {formatGoldChange(item.change_buy, item.unit)}
                            </div>
                          </div>

                          <div style={styles.pricePanel}>
                            <div style={styles.priceLabel}>Bán ra</div>
                            <div style={styles.priceValue}>
                              {formatGoldValue(item.sell_price, item.unit)}
                            </div>
                            <div style={getGoldChangeStyle(item.change_sell, styles, item.unit)}>
                              {formatGoldChange(item.change_sell, item.unit)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div style={styles.dataFoot}>
                  <div>
                    Giá từ nguồn:{" "}
                    {formatDateTime(goldItems[0]?.price_time) || "Chưa có dữ liệu"}
                  </div>
                  <div>
                    Hệ thống đồng bộ:{" "}
                    {formatDateTime(goldItems[0]?.created_at || goldItems[0]?.price_time) ||
                      "Chưa có dữ liệu"}
                  </div>
                </div>
              </div>
            </section>
          )
        ) : mode === "fuel" ? (
          fuelItems.length === 0 ? (
            <div style={styles.emptyCard}>Chưa có dữ liệu giá xăng dầu.</div>
          ) : (
            <section style={styles.sectionCard}>
              <SectionHeader
                title="⛽ Giá xăng dầu hiện tại"
                desc="Sắp xếp ưu tiên RON95, rồi E5/E10, Diesel và Dầu hỏa."
                styles={styles}
              />

              <div style={styles.fuelGrid}>
                {fuelItems.map((item, idx) => (
                  <div key={`${item.fuel_type}-${idx}`} style={styles.fuelCard}>
                    <div style={styles.fuelHead}>
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
          <div style={styles.stockGrid}>
            {items.map((item, idx) => {
              const f = item.fundamental || {};
              const hasTradePlan = hasTradePlanData(item);

              return (
                <article key={`${item.symbol}-${idx}`} style={styles.stockCard}>
                  <div style={styles.stockHeader}>
                    <div>
                      <div style={styles.stockSymbol}>{item.symbol}</div>
                      {f.industry ? <div style={styles.stockIndustry}>{f.industry}</div> : null}
                    </div>

                    <div style={styles.scoreBox}>
                      <div style={styles.scoreText}>Score</div>
                      <div style={styles.scoreNumber}>{formatNum(item.total_score)}</div>
                    </div>
                  </div>

                  <div style={styles.signalRow}>
                    <span style={getActionStyle(item.signal_action, styles)}>
                      {item.signal_action || "WATCH"}
                    </span>

                    {item.signal_strength ? (
                      <span style={styles.badgeSoft}>{item.signal_strength}</span>
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

                  <div style={styles.metricsGrid}>
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
                          : undefined
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

                  <div style={styles.tagRow}>
                    {item.bullish_ma ? <span style={styles.badgeGreen}>MA+</span> : null}
                    {item.bullish_macd ? <span style={styles.badgeBlue}>MACD+</span> : null}
                    {item.breakout_20 ? <span style={styles.badgeOrange}>BO20</span> : null}
                    {item.breakout_55 ? <span style={styles.badgeRed}>BO55</span> : null}
                    {item.price_action && item.price_action !== "neutral" ? (
                      <span style={styles.badgeSoft}>{item.price_action}</span>
                    ) : null}
                  </div>

                  {hasTradePlan ? (
                    <div style={styles.planCard}>
                      <div style={styles.blockTitle}>Kế hoạch giao dịch</div>
                      <div style={styles.planGrid}>
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
                  ) : null}

                  {item.expert_strategy_note ? (
                    <div style={styles.noteCard}>
                      <div style={styles.blockTitle}>Nhận định chuyên gia</div>
                      <div style={styles.noteText}>{item.expert_strategy_note}</div>
                    </div>
                  ) : item.expert_note ? (
                    <div style={styles.noteCard}>
                      <div style={styles.blockTitle}>Nhận định</div>
                      <div style={styles.noteText}>{item.expert_note}</div>
                    </div>
                  ) : null}

                  {f.pe != null || f.pb != null || f.roe != null ? (
                    <div style={styles.fundCard}>
                      <div style={styles.blockTitle}>Cơ bản</div>
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

        <section style={styles.sectionCard}>
          <SectionHeader
            title="⚙️ Cập nhật dữ liệu"
            desc="Chạy cập nhật thủ công cho cổ phiếu, vàng, xăng hoặc toàn bộ hệ thống."
            styles={styles}
          />

          <div style={styles.updateButtons}>
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
            <div style={styles.progressCard}>
              <div style={styles.progressHead}>
                <div style={styles.progressTitle}>
                  {jobStatus.target === "stocks"
                    ? "Tiến trình cập nhật cổ phiếu"
                    : jobStatus.target === "gold"
                    ? "Tiến trình cập nhật vàng"
                    : jobStatus.target === "fuel"
                    ? "Tiến trình cập nhật xăng"
                    : "Tiến trình cập nhật toàn bộ"}
                </div>
                <div style={styles.progressPercent}>{Number(jobStatus.progress || 0)}%</div>
              </div>

              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressBar,
                    width: `${Number(jobStatus.progress || 0)}%`,
                  }}
                />
              </div>

              <div style={styles.progressMessage}>
                {jobStatus.message || "Đang xử lý..."}
              </div>
              <div style={styles.progressMeta}>
                Trạng thái: <strong>{jobStatus.status || "queued"}</strong>
              </div>
            </div>
          ) : (
            <div style={styles.emptyInline}>Chưa có tiến trình cập nhật nào được hiển thị.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoCard({ title, value, styles }) {
  return (
    <div style={styles.infoCard}>
      <div style={styles.infoTitle}>{title}</div>
      <div style={styles.infoValue}>{value}</div>
    </div>
  );
}

function SectionHeader({ title, desc, styles }) {
  return (
    <div style={styles.sectionHeader}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionDesc}>{desc}</div>
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

function Metric({ title, value, sub, color, styles }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: color || styles.metricValue.color }}>
        {value}
      </div>
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
  const num = Number(value);

  if (unit === "VND/lượng") {
    return num.toLocaleString("vi-VN");
  }

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
  if (change == null || Number.isNaN(Number(change))) {
    return styles.goldChangeNeutral;
  }

  const num = Number(change);

  if (unit === "VND/lượng") {
    if (Math.abs(num) < 1000) return styles.goldChangeNeutral;
  } else {
    if (Math.abs(num) < 0.01) return styles.goldChangeNeutral;
  }

  return num >= 0 ? styles.goldChangeUp : styles.goldChangeDown;
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
      bg: "#020617",
      bg2: "#0f172a",
      panel: "rgba(15,23,42,0.84)",
      panelSolid: "#0f172a",
      panelSoft: "#111827",
      line: "rgba(148,163,184,0.14)",
      text: "#f8fafc",
      textSoft: "#94a3b8",
      primary: "#2563eb",
      primary2: "#1d4ed8",
      shadow: "rgba(2,6,23,0.45)",
      glow1: "rgba(37,99,235,0.18)",
      glow2: "rgba(16,185,129,0.16)",
    };
  }

  return {
    bg: "#edf2f7",
    bg2: "#f8fbff",
    panel: "rgba(255,255,255,0.82)",
    panelSolid: "#ffffff",
    panelSoft: "#f8fafc",
    line: "#e5e7eb",
    text: "#0f172a",
    textSoft: "#64748b",
    primary: "#2563eb",
    primary2: "#0f172a",
    shadow: "rgba(15,23,42,0.08)",
    glow1: "rgba(37,99,235,0.10)",
    glow2: "rgba(16,185,129,0.10)",
  };
}

function createStyles(p, isMobile) {
  return {
    page: {
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${p.bg2}, ${p.bg})`,
      padding: isMobile ? 12 : 20,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: "relative",
      overflowX: "hidden",
    },
    glowTop: {
      position: "fixed",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: p.glow1,
      filter: "blur(90px)",
      top: -80,
      left: -80,
      pointerEvents: "none",
    },
    glowBottom: {
      position: "fixed",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: p.glow2,
      filter: "blur(90px)",
      bottom: -80,
      right: -80,
      pointerEvents: "none",
    },
    container: {
      maxWidth: 1140,
      margin: "0 auto",
      position: "relative",
      zIndex: 1,
    },
    heroCard: {
      background: p.panel,
      border: `1px solid ${p.line}`,
      borderRadius: isMobile ? 24 : 28,
      padding: isMobile ? 16 : 22,
      backdropFilter: "blur(16px)",
      boxShadow: `0 24px 60px ${p.shadow}`,
      marginBottom: 16,
    },
    heroTop: {
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "flex-start",
      marginBottom: 16,
    },
    brandBlock: {
      flex: 1,
      minWidth: 0,
    },
    brandEyebrow: {
      fontSize: 11,
      fontWeight: 900,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: p.textSoft,
      marginBottom: 8,
    },
    heroTitle: {
      margin: 0,
      color: p.text,
      fontWeight: 900,
      fontSize: isMobile ? 30 : 38,
      lineHeight: 1.03,
    },
    heroSubtitle: {
      margin: "10px 0 0 0",
      color: p.textSoft,
      fontSize: isMobile ? 14 : 15,
      lineHeight: 1.7,
      maxWidth: 760,
    },
    themeButton: {
      width: isMobile ? 42 : 48,
      height: isMobile ? 42 : 48,
      minWidth: isMobile ? 42 : 48,
      borderRadius: 16,
      border: `1px solid ${p.line}`,
      background: p.panelSolid,
      color: p.text,
      fontSize: isMobile ? 19 : 21,
      cursor: "pointer",
      boxShadow: `0 10px 24px ${p.shadow}`,
    },
    heroStats: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
      gap: 10,
    },
    infoCard: {
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 18,
      padding: isMobile ? 14 : 16,
      boxShadow: `0 10px 24px ${p.shadow}`,
    },
    infoTitle: {
      color: p.textSoft,
      fontWeight: 700,
      fontSize: 12,
      marginBottom: 6,
    },
    infoValue: {
      color: p.text,
      fontWeight: 900,
      fontSize: isMobile ? 14 : 15,
      lineHeight: 1.55,
      wordBreak: "break-word",
    },
    tabScroller: {
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
      marginBottom: 16,
      paddingBottom: 2,
    },
    tabs: {
      display: "flex",
      gap: 8,
      width: "max-content",
    },
    tab: {
      border: `1px solid ${p.line}`,
      background: p.panelSolid,
      color: p.text,
      padding: isMobile ? "11px 14px" : "11px 16px",
      borderRadius: 16,
      cursor: "pointer",
      fontWeight: 800,
      fontSize: isMobile ? 14 : 14,
      whiteSpace: "nowrap",
      boxShadow: `0 8px 18px ${p.shadow}`,
    },
    tabActive: {
      border: "1px solid transparent",
      background: `linear-gradient(135deg, ${p.primary}, ${p.primary2})`,
      color: "#fff",
      padding: isMobile ? "11px 14px" : "11px 16px",
      borderRadius: 16,
      cursor: "pointer",
      fontWeight: 900,
      fontSize: isMobile ? 14 : 14,
      whiteSpace: "nowrap",
      boxShadow: `0 12px 28px ${p.shadow}`,
    },
    sectionCard: {
      background: p.panel,
      border: `1px solid ${p.line}`,
      borderRadius: isMobile ? 24 : 28,
      padding: isMobile ? 16 : 20,
      backdropFilter: "blur(14px)",
      boxShadow: `0 24px 60px ${p.shadow}`,
      marginBottom: 16,
    },
    sectionHeader: {
      marginBottom: 14,
    },
    sectionTitle: {
      color: p.text,
      fontSize: isMobile ? 19 : 22,
      fontWeight: 900,
      marginBottom: 6,
    },
    sectionDesc: {
      color: p.textSoft,
      fontSize: isMobile ? 14 : 14,
      lineHeight: 1.65,
    },
    emptyCard: {
      background: p.panel,
      borderRadius: 24,
      padding: 28,
      color: p.textSoft,
      textAlign: "center",
      boxShadow: `0 18px 40px ${p.shadow}`,
      border: `1px solid ${p.line}`,
    },
    emptyInline: {
      color: p.textSoft,
      fontSize: 14,
    },
    watchToolbar: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
      gap: 10,
      marginBottom: 14,
    },
    input: {
      width: "100%",
      padding: "14px 16px",
      borderRadius: 16,
      border: `1px solid ${p.line}`,
      fontSize: 15,
      background: p.panelSolid,
      color: p.text,
      outline: "none",
      boxSizing: "border-box",
    },
    primaryButton: {
      border: "none",
      background: `linear-gradient(135deg, ${p.primary}, ${p.primary2})`,
      color: "#fff",
      padding: "13px 16px",
      borderRadius: 16,
      fontWeight: 900,
      fontSize: 14,
      cursor: "pointer",
      boxShadow: `0 12px 28px ${p.shadow}`,
      whiteSpace: "nowrap",
    },
    secondaryButton: {
      border: `1px solid ${p.line}`,
      background: p.panelSolid,
      color: p.text,
      padding: "13px 16px",
      borderRadius: 16,
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      boxShadow: `0 8px 18px ${p.shadow}`,
      whiteSpace: "nowrap",
    },
    watchGrid: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
    },
    watchChip: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: p.panelSolid,
      color: p.text,
      padding: "10px 14px",
      borderRadius: 999,
      fontWeight: 800,
      border: `1px solid ${p.line}`,
    },
    removeButton: {
      border: "none",
      background: "transparent",
      color: "#dc2626",
      fontSize: 18,
      lineHeight: 1,
      cursor: "pointer",
      fontWeight: 900,
      padding: 0,
    },
    stockGrid: {
      display: "grid",
      gap: 16,
    },
    stockCard: {
      background: p.panel,
      border: `1px solid ${p.line}`,
      borderRadius: 24,
      padding: isMobile ? 16 : 18,
      boxShadow: `0 20px 50px ${p.shadow}`,
      backdropFilter: "blur(12px)",
    },
    stockHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 14,
    },
    stockSymbol: {
      color: p.text,
      fontSize: isMobile ? 22 : 28,
      fontWeight: 900,
      lineHeight: 1.05,
    },
    stockIndustry: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: 13,
    },
    scoreBox: {
      minWidth: isMobile ? 88 : 96,
      padding: "10px 12px",
      borderRadius: 18,
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      textAlign: "right",
    },
    scoreText: {
      color: p.textSoft,
      fontSize: 11,
      fontWeight: 700,
    },
    scoreNumber: {
      color: p.text,
      fontSize: isMobile ? 26 : 30,
      fontWeight: 900,
      lineHeight: 1.1,
    },
    signalRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 14,
    },
    actionBuy: {
      background: "#dcfce7",
      color: "#166534",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
    },
    actionHold: {
      background: "#dbeafe",
      color: "#1d4ed8",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
    },
    actionWatch: {
      background: "#fef3c7",
      color: "#92400e",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
    },
    actionTp: {
      background: "#ffedd5",
      color: "#c2410c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
    },
    actionSell: {
      background: "#fee2e2",
      color: "#b91c1c",
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 900,
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
    badgeSoft: {
      background: p.panelSolid,
      color: p.textSoft,
      padding: "7px 11px",
      borderRadius: 999,
      fontWeight: 800,
      fontSize: 12,
      border: `1px solid ${p.line}`,
    },
    metricsGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
      gap: 10,
    },
    metricCard: {
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 18,
      padding: isMobile ? 12 : 14,
      minWidth: 0,
    },
    metricTitle: {
      color: p.textSoft,
      fontSize: 12,
      fontWeight: 700,
      marginBottom: 8,
    },
    metricValue: {
      color: p.text,
      fontSize: isMobile ? 22 : 26,
      fontWeight: 900,
      lineHeight: 1.1,
      wordBreak: "break-word",
    },
    metricSub: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: 12,
      lineHeight: 1.45,
      wordBreak: "break-word",
    },
    tagRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 14,
    },
    planCard: {
      marginTop: 14,
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 20,
      padding: 14,
    },
    blockTitle: {
      color: p.text,
      fontSize: 13,
      fontWeight: 900,
      marginBottom: 10,
    },
    planGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
      gap: 10,
    },
    tradeField: {
      background: p.panelSoft,
      border: `1px solid ${p.line}`,
      borderRadius: 16,
      padding: 12,
      minWidth: 0,
    },
    tradeLabel: {
      color: p.textSoft,
      fontSize: 12,
      fontWeight: 700,
      marginBottom: 6,
    },
    tradeValue: {
      color: p.text,
      fontSize: 15,
      fontWeight: 800,
      lineHeight: 1.4,
      wordBreak: "break-word",
    },
    noteCard: {
      marginTop: 14,
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 20,
      padding: 14,
    },
    noteText: {
      color: p.text,
      fontSize: 14,
      lineHeight: 1.7,
    },
    fundCard: {
      marginTop: 14,
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 20,
      padding: 14,
    },
    fundRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 14,
      color: p.text,
      fontSize: 13,
      fontWeight: 800,
    },
    goldList: {
      display: "grid",
      gap: 12,
    },
    goldItem: {
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 22,
      padding: isMobile ? 14 : 16,
      boxShadow: `0 10px 24px ${p.shadow}`,
    },
    goldItemTop: {
      marginBottom: 12,
    },
    goldTitleWrap: {
      minWidth: 0,
    },
    goldName: {
      color: p.text,
      fontSize: isMobile ? 18 : 22,
      fontWeight: 900,
      lineHeight: 1.2,
    },
    goldSubtitle: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: isMobile ? 13 : 14,
      lineHeight: 1.45,
    },
    goldPriceGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 10,
    },
    goldPriceGridSingle: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 10,
    },
    pricePanel: {
      background: p.panelSoft,
      border: `1px solid ${p.line}`,
      borderRadius: 18,
      padding: isMobile ? 12 : 14,
      minWidth: 0,
    },
    priceLabel: {
      color: p.textSoft,
      fontSize: 12,
      fontWeight: 700,
      marginBottom: 8,
    },
    priceValue: {
      color: p.text,
      fontSize: isMobile ? 17 : 24,
      fontWeight: 900,
      lineHeight: 1.18,
      wordBreak: "break-word",
      letterSpacing: isMobile ? "-0.3px" : 0,
    },
    goldChangeUp: {
      marginTop: 6,
      color: "#16a34a",
      fontSize: isMobile ? 14 : 16,
      fontWeight: 900,
      lineHeight: 1.25,
      minHeight: 18,
      wordBreak: "break-word",
    },
    goldChangeDown: {
      marginTop: 6,
      color: "#dc2626",
      fontSize: isMobile ? 14 : 16,
      fontWeight: 900,
      lineHeight: 1.25,
      minHeight: 18,
      wordBreak: "break-word",
    },
    goldChangeNeutral: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: isMobile ? 14 : 16,
      fontWeight: 800,
      lineHeight: 1.25,
      minHeight: 18,
    },
    dataFoot: {
      marginTop: 2,
      color: p.textSoft,
      fontSize: isMobile ? 12 : 13,
      lineHeight: 1.6,
      padding: "2px 2px 0 2px",
      wordBreak: "break-word",
    },
    fuelGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 12,
    },
    fuelCard: {
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 22,
      padding: 16,
      boxShadow: `0 10px 24px ${p.shadow}`,
    },
    fuelHead: {
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
      padding: "5px 10px",
      borderRadius: 999,
      background: p.panelSoft,
      color: p.textSoft,
      border: `1px solid ${p.line}`,
      fontSize: 11,
      fontWeight: 800,
    },
    fuelName: {
      color: p.text,
      fontSize: 18,
      fontWeight: 900,
      lineHeight: 1.3,
      marginBottom: 10,
    },
    fuelPrice: {
      color: "#16a34a",
      fontSize: 30,
      fontWeight: 900,
      lineHeight: 1.1,
      wordBreak: "break-word",
    },
    fuelUnit: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: 13,
    },
    fuelTime: {
      marginTop: 10,
      color: p.textSoft,
      fontSize: 12,
      lineHeight: 1.5,
    },
    updateButtons: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, max-content)",
      gap: 10,
      alignItems: "stretch",
    },
    progressCard: {
      marginTop: 14,
      background: p.panelSolid,
      border: `1px solid ${p.line}`,
      borderRadius: 20,
      padding: 14,
      boxShadow: `0 10px 24px ${p.shadow}`,
    },
    progressHead: {
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      alignItems: "center",
      marginBottom: 10,
    },
    progressTitle: {
      color: p.text,
      fontSize: 14,
      fontWeight: 900,
    },
    progressPercent: {
      color: p.primary,
      fontSize: 14,
      fontWeight: 900,
    },
    progressTrack: {
      width: "100%",
      height: 10,
      background: p.line,
      borderRadius: 999,
      overflow: "hidden",
    },
    progressBar: {
      height: "100%",
      borderRadius: 999,
      background: `linear-gradient(90deg, #22c55e, ${p.primary})`,
      transition: "width 0.35s ease",
    },
    progressMessage: {
      marginTop: 10,
      color: p.text,
      fontSize: 13,
      fontWeight: 800,
      wordBreak: "break-word",
      lineHeight: 1.5,
    },
    progressMeta: {
      marginTop: 6,
      color: p.textSoft,
      fontSize: 12,
    },
  };
}
