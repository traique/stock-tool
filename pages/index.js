import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  Moon,
  SunMedium,
  LineChart,
  Search,
  Star,
  Gem,
  Fuel,
  RefreshCw,
  Activity,
  Target,
  Shield,
  BarChart3,
  Wallet,
  TrendingUp,
} from "lucide-react";

const TABS = [
  { key: "stocks", label: "Cổ phiếu", icon: LineChart },
  { key: "screener", label: "Screener", icon: Search },
  { key: "watchlist", label: "Watchlist", icon: Star },
  { key: "gold", label: "Giá vàng", icon: Gem },
  { key: "fuel", label: "Giá xăng", icon: Fuel },
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
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("alpha-theme") : null;
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

  const latestGoldSourceTime = useMemo(
    () => getLatestDateValue(goldItems, "price_time"),
    [goldItems]
  );

  const latestGoldSyncTime = useMemo(
    () =>
      getLatestDateValue(goldItems, "created_at") ||
      getLatestDateValue(goldItems, "price_time"),
    [goldItems]
  );

  const latestFuelTime = useMemo(
    () => getLatestDateValue(fuelItems, "effective_time"),
    [fuelItems]
  );

  const latestMarketTime = useMemo(() => status?.last_updated || null, [status]);

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
          message:
            data.github_response || data.detail || data.error || "Không gọi được workflow",
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
    <>
      <Head>
        <title>AlphaPulse Elite</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Noto+Serif:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div style={styles.page}>
        <div style={styles.auroraOne} />
        <div style={styles.auroraTwo} />

        <div style={styles.shell}>
          <section style={styles.heroCard}>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              style={styles.themeButton}
              aria-label="Đổi giao diện"
              title="Đổi giao diện"
            >
              {theme === "light" ? <Moon size={18} /> : <SunMedium size={18} />}
            </button>

            <div style={styles.heroEyebrow}>LCTA</div>
            <h1 style={styles.heroTitle}>AlphaPulse Elite</h1>
          </section>

          <div style={styles.tabWrap}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setMode(tab.key)}
                  style={mode === tab.key ? styles.tabActive : styles.tab}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {mode === "watchlist" ? (
            <section style={styles.card}>
              <SectionTitle styles={styles} text="Watchlist" />

              <div style={styles.watchInputRow}>
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="Nhập mã cổ phiếu, ví dụ FPT"
                  style={styles.input}
                />
                <button onClick={addStock} style={styles.primaryButton}>
                  Thêm mã
                </button>
              </div>

              <div style={styles.watchChips}>
                {stocks.length === 0 ? (
                  <div style={styles.muted}>Chưa có mã nào trong watchlist.</div>
                ) : (
                  stocks.map((item, idx) => (
                    <div key={`${item.symbol}-${idx}`} style={styles.watchChip}>
                      <span>{item.symbol}</span>
                      <button
                        onClick={() => removeStock(item.symbol)}
                        style={styles.removeButton}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : loading ? (
            <div style={styles.card}>Đang tải dữ liệu...</div>
          ) : mode === "gold" ? (
            goldItems.length === 0 ? (
              <div style={styles.card}>Chưa có dữ liệu giá vàng.</div>
            ) : (
              <section style={styles.contentGrid}>
                {goldItems.map((item, idx) => {
                  const isWorldGold =
                    item.gold_type === "world_xauusd" ||
                    String(item.subtitle || "").toUpperCase() === "XAU/USD";

                  return (
                    <article key={`${item.gold_type}-${idx}`} style={styles.card}>
                      <div style={styles.cardHead}>
                        <div>
                          <div style={styles.cardTitle}>{item.display_name || item.gold_type}</div>
                          <div style={styles.muted}>{item.subtitle || item.source}</div>
                        </div>
                        <Gem size={18} color={palette.muted} />
                      </div>

                      {isWorldGold ? (
                        <div style={styles.singlePriceBox}>
                          <div style={styles.label}>Giá hiện tại</div>
                          <div style={styles.bigNumber}>
                            {formatGoldValue(item.buy_price, item.unit)}
                          </div>
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
                            change={item.change_buy}
                            unit={item.unit}
                          />
                          <ValueBox
                            styles={styles}
                            label="Bán ra"
                            value={formatGoldValue(item.sell_price, item.unit)}
                            change={item.change_sell}
                            unit={item.unit}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )
          ) : mode === "fuel" ? (
            fuelItems.length === 0 ? (
              <div style={styles.card}>Chưa có dữ liệu giá xăng dầu.</div>
            ) : (
              <section style={styles.contentGrid}>
                {fuelItems.map((item, idx) => (
                  <article key={`${item.fuel_type}-${idx}`} style={styles.card}>
                    <div style={styles.cardHead}>
                      <div style={styles.cardTitle}>{item.fuel_type}</div>
                      <Fuel size={18} color={palette.muted} />
                    </div>
                    <div style={styles.bigNumberGreen}>{formatPrice(item.price)}</div>
                    <div style={styles.muted}>{item.unit || "VND/liter"}</div>
                  </article>
                ))}
              </section>
            )
          ) : items.length === 0 ? (
            <div style={styles.card}>Chưa có dữ liệu phù hợp.</div>
          ) : (
            <section style={styles.stockList}>
              {items.map((item, idx) => {
                const f = item.fundamental || {};
                const hasTradePlan = hasTradePlanData(item);

                return (
                  <article key={`${item.symbol}-${idx}`} style={styles.card}>
                    <div style={styles.stockHeader}>
                      <div>
                        <div style={styles.stockTitle}>{item.symbol}</div>
                        <div style={styles.muted}>{f.industry || "Chưa có ngành"}</div>
                      </div>

                      <div style={styles.scoreBox}>
                        <div style={styles.scoreLabel}>Score</div>
                        <div style={styles.scoreValue}>{formatNum(item.total_score)}</div>
                      </div>
                    </div>

                    <div style={styles.badgeRow}>
                      <span style={getActionStyle(item.signal_action, styles)}>
                        {item.signal_action || "WATCH"}
                      </span>
                      {item.signal_strength ? (
                        <span style={styles.softPill}>{item.signal_strength}</span>
                      ) : null}
                      {item.setup_type ? (
                        <span style={styles.softPillBlue}>{item.setup_type}</span>
                      ) : null}
                      {item.confidence_score != null ? (
                        <span style={styles.softPillGreen}>
                          Conf {formatNum(item.confidence_score)}
                        </span>
                      ) : null}
                    </div>

                    <div style={styles.metricGrid}>
                      <MetricBox
                        styles={styles}
                        title="Giá"
                        value={formatNum(item.close)}
                        icon={<Target size={15} />}
                      />
                      <MetricBox
                        styles={styles}
                        title="RSI"
                        value={formatNum(item.rsi)}
                        note={
                          item.overbought ? "Quá mua" : item.oversold ? "Quá bán" : "Trung tính"
                        }
                        icon={<Activity size={15} />}
                      />
                      <MetricBox
                        styles={styles}
                        title="MACD"
                        value={formatNum(item.macd)}
                        note={`Signal ${formatNum(item.macd_signal)}`}
                        icon={<TrendingUp size={15} />}
                      />
                      <MetricBox
                        styles={styles}
                        title="Volume"
                        value={formatNum(item.volume_ratio)}
                        note={`MA20 ${formatNum(item.volume_ma20)}`}
                        icon={<BarChart3 size={15} />}
                      />
                      <MetricBox
                        styles={styles}
                        title="MA"
                        value={`20 ${formatNum(item.ma20)}`}
                        note={`50 ${formatNum(item.ma50)} · 100 ${formatNum(item.ma100)}`}
                        icon={<LineChart size={15} />}
                      />
                      <MetricBox
                        styles={styles}
                        title="Breakout"
                        value={item.breakout_55 ? "55 phiên" : item.breakout_20 ? "20 phiên" : "-"}
                        note={`MA20 ${formatNum(item.distance_ma20)}%`}
                        icon={<Target size={15} />}
                      />
                    </div>

                    {hasTradePlan ? (
                      <div style={styles.subCard}>
                        <div style={styles.subCardTitle}>Kế hoạch giao dịch</div>
                        <div style={styles.metricGridCompact}>
                          <MetricBox
                            styles={styles}
                            title="Điểm vào"
                            value={formatNum(item.entry_price)}
                            compact
                            icon={<Target size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="Vùng mua"
                            value={
                              hasMeaningfulNumber(item.entry_zone_low) &&
                              hasMeaningfulNumber(item.entry_zone_high)
                                ? `${formatNum(item.entry_zone_low)} - ${formatNum(
                                    item.entry_zone_high
                                  )}`
                                : "-"
                            }
                            compact
                            icon={<Wallet size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="SL"
                            value={formatNum(item.stop_loss)}
                            compact
                            icon={<Shield size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="TP1"
                            value={formatNum(item.take_profit_1)}
                            compact
                            icon={<TrendingUp size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="TP2"
                            value={formatNum(item.take_profit_2)}
                            compact
                            icon={<TrendingUp size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="Trailing"
                            value={formatNum(item.trailing_stop)}
                            compact
                            icon={<RefreshCw size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="R/R"
                            value={formatNum(item.risk_reward_ratio)}
                            compact
                            icon={<BarChart3 size={15} />}
                          />
                          <MetricBox
                            styles={styles}
                            title="Tỷ trọng"
                            value={
                              hasMeaningfulNumber(item.position_size_pct)
                                ? `${formatNum(item.position_size_pct)}%`
                                : "-"
                            }
                            compact
                            icon={<Wallet size={15} />}
                          />
                        </div>
                      </div>
                    ) : null}

                    {item.expert_strategy_note || item.expert_note ? (
                      <div style={styles.subCard}>
                        <div style={styles.subCardTitle}>
                          {item.expert_strategy_note ? "Nhận định chuyên gia" : "Nhận định"}
                        </div>
                        <div style={styles.noteText}>
                          {item.expert_strategy_note || item.expert_note}
                        </div>
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
            <SectionTitle styles={styles} text="Cập nhật dữ liệu" />

            <div style={styles.updateGrid}>
              <button
                style={styles.secondaryButton}
                onClick={() => runUpdate("stocks")}
                disabled={jobRunning}
              >
                <RefreshCw size={16} />
                <span>Cập nhật cổ phiếu</span>
              </button>

              <button
                style={styles.secondaryButton}
                onClick={() => runUpdate("gold")}
                disabled={jobRunning}
              >
                <Gem size={16} />
                <span>Cập nhật vàng</span>
              </button>

              <button
                style={styles.secondaryButton}
                onClick={() => runUpdate("fuel")}
                disabled={jobRunning}
              >
                <Fuel size={16} />
                <span>Cập nhật xăng</span>
              </button>

              <button
                style={styles.primaryButton}
                onClick={() => runUpdate("all")}
                disabled={jobRunning}
              >
                <RefreshCw size={16} />
                <span>Cập nhật tất cả</span>
              </button>
            </div>

            {jobStatus ? (
              <div style={styles.progressWrap}>
                <div style={styles.rowBetween}>
                  <div style={styles.subCardTitle}>Tiến trình cập nhật</div>
                  <div style={styles.progressText}>{Number(jobStatus.progress || 0)}%</div>
                </div>
                <div style={styles.progressTrack}>
                  <div
                    style={{
                      ...styles.progressBar,
                      width: `${Number(jobStatus.progress || 0)}%`,
                    }}
                  />
                </div>
                <div style={styles.noteText}>{jobStatus.message || "Đang xử lý..."}</div>
                <div style={styles.muted}>Trạng thái: {jobStatus.status || "queued"}</div>
              </div>
            ) : (
              <div style={styles.muted}>Chưa có tiến trình cập nhật nào được hiển thị.</div>
            )}
          </section>

          <section style={styles.statusGrid}>
            <StatusCard
              styles={styles}
              title="Cập nhật thị trường"
              value={formatDateTime(latestMarketTime)}
            />
            <StatusCard
              styles={styles}
              title="Giá vàng mới nhất"
              value={formatDateTime(latestGoldSourceTime)}
            />
            <StatusCard
              styles={styles}
              title="Đồng bộ giá vàng"
              value={formatDateTime(latestGoldSyncTime)}
            />
            <StatusCard
              styles={styles}
              title="Giá xăng hiệu lực"
              value={formatDateTime(latestFuelTime)}
            />
          </section>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ styles, text }) {
  return <div style={styles.sectionTitle}>{text}</div>;
}

function StatusCard({ styles, title, value }) {
  return (
    <div style={styles.statusCard}>
      <div style={styles.statusLabel}>{title}</div>
      <div style={styles.statusValue}>{value || "Chưa có dữ liệu"}</div>
    </div>
  );
}

function ValueBox({ styles, label, value, change, unit }) {
  return (
    <div style={styles.valueBox}>
      <div style={styles.label}>{label}</div>
      <div style={styles.valueBoxNumber}>{value}</div>
      <div style={getGoldChangeStyle(change, styles, unit)}>
        {formatGoldChange(change, unit) || "Không đổi"}
      </div>
    </div>
  );
}

function MetricBox({ styles, title, value, note, compact = false, icon = null }) {
  return (
    <div style={compact ? styles.metricBoxCompact : styles.metricBox}>
      <div style={styles.metricTop}>
        <div style={styles.label}>{title}</div>
        {icon ? <div style={styles.metricIcon}>{icon}</div> : null}
      </div>
      <div style={compact ? styles.metricCompactValue : styles.metricValue}>{value}</div>
      {note ? <div style={styles.metricNote}>{note}</div> : null}
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
    return `${num > 0 ? "+" : "-"}${Math.abs(Math.round(num)).toLocaleString("vi-VN")}`;
  }

  if (Math.abs(num) < 0.01) return "";
  return `${num > 0 ? "+" : "-"}${Math.abs(num).toLocaleString("en-US", {
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

function hasMeaningfulNumber(value) {
  if (value == null || value === "") return false;
  const num = Number(value);
  if (Number.isNaN(num)) return false;
  return Math.abs(num) > 0.000001;
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
  ].some((value) => hasMeaningfulNumber(value));
}

function getPalette(theme) {
  if (theme === "dark") {
    return {
      bg: "#07111f",
      bgSoft: "#0d1728",
      card: "rgba(14,23,38,0.88)",
      cardSoft: "rgba(18,28,45,0.94)",
      line: "rgba(148,163,184,0.14)",
      text: "#f8fafc",
      subtext: "#dbe4f0",
      muted: "#93a3b8",
      primary: "#3b82f6",
      primaryStrong: "#1d4ed8",
      shadow: "rgba(2,6,23,0.42)",
      serif: "'Noto Serif', Georgia, serif",
      sans: "'Be Vietnam Pro', Inter, Arial, sans-serif",
    };
  }

  return {
    bg: "#f3f5fb",
    bgSoft: "#eef2f8",
    card: "rgba(255,255,255,0.9)",
    cardSoft: "rgba(248,250,252,0.98)",
    line: "rgba(148,163,184,0.20)",
    text: "#0f172a",
    subtext: "#334155",
    muted: "#64748b",
    primary: "#2563eb",
    primaryStrong: "#1d4ed8",
    shadow: "rgba(15,23,42,0.08)",
    serif: "'Noto Serif', Georgia, serif",
    sans: "'Be Vietnam Pro', Inter, Arial, sans-serif",
  };
}

function createStyles(p, isMobile) {
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
      top: -40,
      left: -40,
      width: 220,
      height: 220,
      borderRadius: "50%",
      background: "rgba(59,130,246,0.12)",
      filter: "blur(80px)",
      pointerEvents: "none",
    },
    auroraTwo: {
      position: "fixed",
      right: -40,
      bottom: -40,
      width: 240,
      height: 240,
      borderRadius: "50%",
      background: "rgba(99,102,241,0.10)",
      filter: "blur(90px)",
      pointerEvents: "none",
    },
    shell: {
      maxWidth: 1180,
      margin: "0 auto",
      position: "relative",
      zIndex: 1,
      display: "grid",
      gap: 14,
    },
    heroCard: {
      position: "relative",
      background: p.card,
      border: `1px solid ${p.line}`,
      borderRadius: 28,
      padding: isMobile ? 18 : 24,
      boxShadow: `0 20px 40px ${p.shadow}`,
      backdropFilter: "blur(14px)",
      minHeight: isMobile ? 120 : 150,
    },
    themeButton: {
      position: "absolute",
      top: 16,
      right: 16,
      width: 42,
      height: 42,
      borderRadius: 14,
      border: `1px solid ${p.line}`,
      background: p.cardSoft,
      color: p.text,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      boxShadow: `0 10px 20px ${p.shadow}`,
    },
    heroEyebrow: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 10,
    },
    heroTitle: {
      margin: 0,
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 40 : 56,
      lineHeight: 1.02,
      letterSpacing: -0.5,
      paddingRight: 54,
    },
    tabWrap: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
    },
    tab: {
      border: `1px solid ${p.line}`,
      background: p.card,
      color: p.text,
      padding: "11px 14px",
      borderRadius: 999,
      cursor: "pointer",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
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
      lineHeight: 1.5,
      fontWeight: 800,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      boxShadow: `0 12px 22px ${p.shadow}`,
    },
    contentGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
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
    cardHead: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
    },
    cardTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 28 : 32,
      lineHeight: 1.1,
      fontWeight: 700,
    },
    label: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
      marginBottom: 8,
    },
    muted: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.6,
    },
    singlePriceBox: {
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 16,
    },
    dualGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 10,
    },
    valueBox: {
      borderRadius: 22,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: 14,
      minWidth: 0,
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
      lineHeight: 1.25,
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
    stockHeader: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
      gap: 12,
      alignItems: "start",
      marginBottom: 14,
    },
    stockTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 32 : 38,
      lineHeight: 1.04,
      fontWeight: 700,
    },
    scoreBox: {
      borderRadius: 20,
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      padding: "12px 14px",
      minWidth: isMobile ? 0 : 108,
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
    softPill: {
      background: p.cardSoft,
      border: `1px solid ${p.line}`,
      color: p.subtext,
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    softPillBlue: {
      background: "rgba(59,130,246,0.12)",
      color: "#2563eb",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    softPillGreen: {
      background: "rgba(34,197,94,0.12)",
      color: "#15803d",
      borderRadius: 999,
      padding: "7px 10px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
    },
    actionBuy: {
      background: "rgba(34,197,94,0.14)",
      color: "#15803d",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionHold: {
      background: "rgba(59,130,246,0.14)",
      color: "#2563eb",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionTp: {
      background: "rgba(249,115,22,0.14)",
      color: "#c2410c",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionSell: {
      background: "rgba(239,68,68,0.14)",
      color: "#b91c1c",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    actionWatch: {
      background: "rgba(245,158,11,0.16)",
      color: "#92400e",
      borderRadius: 999,
      padding: "8px 12px",
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 800,
    },
    metricGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
      gap: 10,
    },
    metricGridCompact: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
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
    metricTop: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 2,
    },
    metricIcon: {
      color: p.muted,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
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
    sectionTitle: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 28 : 32,
      lineHeight: 1.1,
      fontWeight: 700,
      marginBottom: 0,
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
      fontFamily: p.sans,
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
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      boxShadow: `0 12px 24px ${p.shadow}`,
      fontFamily: p.sans,
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
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      boxShadow: `0 8px 18px ${p.shadow}`,
      fontFamily: p.sans,
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
    rowBetween: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 10,
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
      background: "rgba(148,163,184,0.22)",
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
    statusGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
      gap: 14,
    },
    statusCard: {
      background: p.card,
      border: `1px solid ${p.line}`,
      borderRadius: 24,
      padding: 16,
      boxShadow: `0 16px 32px ${p.shadow}`,
    },
    statusLabel: {
      color: p.muted,
      fontSize: 12,
      lineHeight: 1.4,
      fontWeight: 700,
      marginBottom: 10,
    },
    statusValue: {
      color: p.text,
      fontFamily: p.serif,
      fontSize: isMobile ? 24 : 28,
      lineHeight: 1.2,
      fontWeight: 700,
      wordBreak: "break-word",
    },
  };
}
