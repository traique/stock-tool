import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  Moon,
  SunMedium,
  LineChart,
  Search,
  Gem,
  Fuel,
  RefreshCw,
  Activity,
  Target,
  Shield,
  BarChart3,
  Wallet,
  TrendingUp,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";

const TABS = [
  { key: "stocks", label: "Cổ phiếu", icon: LineChart },
  { key: "screener", label: "Screener", icon: Search },
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
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobRunning, setJobRunning] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("alpha-theme") : null;
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
    } else if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setTheme("dark");
    }

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
  const latestMarketTime = useMemo(() => status?.last_updated || null, [status]);

  const stockMap = useMemo(() => {
    const map = {};
    for (const row of stocks || []) {
      const key = String(row.symbol || "").trim().toUpperCase();
      if (key) map[key] = true;
    }
    return map;
  }, [stocks]);

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toUpperCase();
    const source = Array.isArray(items) ? items : [];
    if (!q) return source;
    return source.filter((item) => String(item.symbol || "").toUpperCase().includes(q));
  }, [items, searchText]);

  const stockSummary = useMemo(() => {
    const source = Array.isArray(items) ? items : [];
    return {
      total: source.length,
      buy: source.filter((x) => String(x.signal_action || "").toUpperCase() === "BUY").length,
      hold: source.filter((x) => String(x.signal_action || "").toUpperCase() === "HOLD").length,
      risk: source.filter((x) => ["SELL", "CUT_LOSS", "TAKE_PROFIT"].includes(String(x.signal_action || "").toUpperCase())).length,
    };
  }, [items]);

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
      const res = await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) return;
      setNewSymbol("");
      await loadStocks();
      if (mode === "stocks" || mode === "screener") {
        await loadData();
        await loadStatus();
      }
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
      if (mode === "stocks" || mode === "screener") {
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
      setJobStatus({ target, status: "queued", progress: 8, message: "Đang gửi lệnh cập nhật..." });
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
    <>
      <Head>
        <title>AlphaPulse Elite</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <div style={styles.page}>
        <div style={styles.glowOne} />
        <div style={styles.glowTwo} />

        <div style={styles.shell}>
          <section style={styles.hero}>
            <div style={styles.heroTop}>
              <div>
                <div style={styles.heroEyebrow}>AlphaPulse · Vietnam Market</div>
                <div style={styles.heroStats}>
                  <HeroStat styles={styles} label="Watchlist" value={String(stocks.length || 0)} />
                  <HeroStat styles={styles} label="BUY" value={String(stockSummary.buy || 0)} />
                  <HeroStat styles={styles} label="HOLD" value={String(stockSummary.hold || 0)} />
                  <HeroStat styles={styles} label="Cần chú ý" value={String(stockSummary.risk || 0)} />
                </div>
              </div>

              <button
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                style={styles.themeButton}
                aria-label="Đổi giao diện"
                title="Đổi giao diện"
              >
                {theme === "light" ? <Moon size={18} /> : <SunMedium size={18} />}
              </button>
            </div>
          </section>

          <div style={styles.segmentWrap}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setMode(tab.key)} style={mode === tab.key ? styles.segmentActive : styles.segment}>
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {mode === "stocks" ? (
            <>
              <section style={styles.glassCard}>
                <div style={styles.toolbarTop}>
                  <SectionTitle styles={styles} text="Danh mục cổ phiếu" />
                  <div style={styles.toolbarNote}>{formatDateTime(latestMarketTime) || "Chưa có dữ liệu"}</div>
                </div>

                <div style={styles.toolbarRow}>
                  <div style={styles.inputShell}>
                    <input
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addStock();
                      }}
                      placeholder="Thêm mã, ví dụ FPT"
                      style={styles.input}
                    />
                    <button onClick={addStock} style={styles.addButton}>
                      <Plus size={16} />
                      <span>Thêm mã</span>
                    </button>
                  </div>

                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Tìm mã"
                    style={styles.searchInput}
                  />
                </div>
              </section>

              {loading ? (
                <div style={styles.glassCard}>Đang tải dữ liệu...</div>
              ) : filteredItems.length === 0 ? (
                <div style={styles.glassCard}>Chưa có dữ liệu phù hợp.</div>
              ) : (
                <section style={styles.stockGrid}>
                  {filteredItems.map((item, idx) => {
                    const hasTradePlan = hasTradePlanData(item);
                    return (
                      <article key={`${item.symbol}-${idx}`} style={styles.stockCard}>
                        <div style={styles.stockCardTop}>
                          <div style={styles.stockSymbolRow}>
                            <div style={styles.stockTitle}>{item.symbol}</div>
                            <span style={getActionStyle(item.signal_action, styles)}>{item.signal_action || "WATCH"}</span>
                          </div>

                          <div style={styles.cardTopActions}>
                            <div style={styles.scoreBadge}>
                              <div style={styles.scoreBadgeLabel}>Score</div>
                              <div style={styles.scoreBadgeValue}>{formatNum(item.total_score)}</div>
                            </div>
                            {stockMap[item.symbol] ? (
                              <button onClick={() => removeStock(item.symbol)} style={styles.iconDangerButton} title={`Xóa ${item.symbol}`}>
                                <Trash2 size={16} />
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div style={styles.badgeRow}>
                          {item.signal_strength ? <span style={styles.softPill}>{item.signal_strength}</span> : null}
                          {item.setup_type && item.setup_type !== "NONE" ? <span style={styles.softPillBlue}>{item.setup_type}</span> : null}
                          {item.confidence_score != null ? <span style={styles.softPillGreen}>Conf {formatNum(item.confidence_score)}</span> : null}
                        </div>

                        <div style={styles.metricsRow}>
                          <MetricTile styles={styles} title="Giá" value={formatNum(item.close)} icon={<Target size={15} />} />
                          <MetricTile
                            styles={styles}
                            title="RSI"
                            value={formatNum(item.rsi)}
                            note={item.overbought ? "Quá mua" : item.oversold ? "Quá bán" : "Trung tính"}
                            icon={<Activity size={15} />}
                          />
                          <MetricTile
                            styles={styles}
                            title="MACD"
                            value={formatNum(item.macd)}
                            note={`Signal ${formatNum(item.macd_signal)}`}
                            icon={<TrendingUp size={15} />}
                          />
                          <MetricTile
                            styles={styles}
                            title="Volume"
                            value={formatNum(item.volume_ratio)}
                            note={`MA20 ${formatNum(item.volume_ma20)}`}
                            icon={<BarChart3 size={15} />}
                          />
                        </div>

                        <div style={styles.bottomInfoGrid}>
                          <InfoStrip styles={styles} label="MA" value={`20 ${formatNum(item.ma20)} · 50 ${formatNum(item.ma50)} · 100 ${formatNum(item.ma100)}`} />
                          <InfoStrip
                            styles={styles}
                            label="Breakout"
                            value={item.breakout_55 ? "55 phiên" : item.breakout_20 ? "20 phiên" : `MA20 ${formatNum(item.distance_ma20)}%`}
                          />
                        </div>

                        {hasTradePlan ? (
                          <div style={styles.subCard}>
                            <div style={styles.subCardTitle}>Kế hoạch giao dịch</div>
                            <div style={styles.tradePlanGrid}>
                              <MiniMetric styles={styles} title="Điểm vào" value={formatNum(item.entry_price)} icon={<Target size={14} />} />
                              <MiniMetric
                                styles={styles}
                                title="Vùng mua"
                                value={hasMeaningfulNumber(item.entry_zone_low) && hasMeaningfulNumber(item.entry_zone_high) ? `${formatNum(item.entry_zone_low)} - ${formatNum(item.entry_zone_high)}` : "-"}
                                icon={<Wallet size={14} />}
                              />
                              <MiniMetric styles={styles} title="SL" value={formatNum(item.stop_loss)} icon={<Shield size={14} />} />
                              <MiniMetric styles={styles} title="TP1" value={formatNum(item.take_profit_1)} icon={<TrendingUp size={14} />} />
                              <MiniMetric styles={styles} title="TP2" value={formatNum(item.take_profit_2)} icon={<TrendingUp size={14} />} />
                              <MiniMetric styles={styles} title="R/R" value={formatNum(item.risk_reward_ratio)} icon={<BarChart3 size={14} />} />
                            </div>
                          </div>
                        ) : null}

                        {item.expert_strategy_note || item.expert_note ? (
                          <div style={styles.noteCard}>
                            <div style={styles.noteTitle}>
                              <Sparkles size={15} />
                              <span>Nhận định</span>
                            </div>
                            <div style={styles.noteText}>{item.expert_strategy_note || item.expert_note}</div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </section>
              )}
            </>
          ) : loading ? (
            <div style={styles.glassCard}>Đang tải dữ liệu...</div>
          ) : mode === "gold" ? (
            goldItems.length === 0 ? (
              <div style={styles.glassCard}>Chưa có dữ liệu giá vàng.</div>
            ) : (
              <section style={styles.dualGrid}>
                {goldItems.map((item, idx) => {
                  const isWorldGold = item.gold_type === "world_xauusd" || String(item.subtitle || "").toUpperCase() === "XAU/USD";
                  return (
                    <article key={`${item.gold_type}-${idx}`} style={styles.stockCard}>
                      <div style={styles.stockCardTop}>
                        <div>
                          <div style={styles.stockTitle}>{item.display_name || item.gold_type}</div>
                          <div style={styles.timestampText}>{item.subtitle || item.source}</div>
                        </div>
                        <div style={styles.iconBadge}><Gem size={16} /></div>
                      </div>

                      {isWorldGold ? (
                        <div style={styles.singleHeroMetric}>
                          <div style={styles.metricLabel}>Giá hiện tại</div>
                          <div style={styles.heroNumber}>{formatGoldValue(item.buy_price, item.unit)}</div>
                          <div style={getGoldChangeStyle(item.change_buy, styles, item.unit)}>{formatGoldChange(item.change_buy, item.unit) || "Không đổi"}</div>
                        </div>
                      ) : (
                        <div style={styles.metricsRow}>
                          <MetricTile styles={styles} title="Mua vào" value={formatGoldValue(item.buy_price, item.unit)} note={formatGoldChange(item.change_buy, item.unit) || "Không đổi"} icon={<Wallet size={15} />} />
                          <MetricTile styles={styles} title="Bán ra" value={formatGoldValue(item.sell_price, item.unit)} note={formatGoldChange(item.change_sell, item.unit) || "Không đổi"} icon={<TrendingUp size={15} />} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )
          ) : mode === "fuel" ? (
            fuelItems.length === 0 ? (
              <div style={styles.glassCard}>Chưa có dữ liệu giá xăng dầu.</div>
            ) : (
              <section style={styles.dualGrid}>
                {fuelItems.map((item, idx) => (
                  <article key={`${item.fuel_type}-${idx}`} style={styles.stockCard}>
                    <div style={styles.stockCardTop}>
                      <div>
                        <div style={styles.stockTitle}>{item.fuel_type}</div>
                        <div style={styles.timestampText}>{item.unit || "VND/liter"}</div>
                      </div>
                      <div style={styles.iconBadge}><Fuel size={16} /></div>
                    </div>
                    <div style={styles.heroNumberGreen}>{formatPrice(item.price)}</div>
                  </article>
                ))}
              </section>
            )
          ) : items.length === 0 ? (
            <div style={styles.glassCard}>Chưa có dữ liệu phù hợp.</div>
          ) : (
            <section style={styles.stockGrid}>
              {items.map((item, idx) => (
                <article key={`${item.symbol}-${idx}`} style={styles.stockCard}>
                  <div style={styles.stockCardTop}>
                    <div style={styles.stockTitle}>{item.symbol}</div>
                    <div style={styles.scoreBadge}>
                      <div style={styles.scoreBadgeLabel}>Score</div>
                      <div style={styles.scoreBadgeValue}>{formatNum(item.total_score)}</div>
                    </div>
                  </div>
                  <div style={styles.badgeRow}>
                    <span style={getActionStyle(item.signal_action, styles)}>{item.signal_action || "WATCH"}</span>
                    {item.signal_strength ? <span style={styles.softPill}>{item.signal_strength}</span> : null}
                    {item.confidence_score != null ? <span style={styles.softPillGreen}>Conf {formatNum(item.confidence_score)}</span> : null}
                  </div>
                  <div style={styles.metricsRow}>
                    <MetricTile styles={styles} title="Giá" value={formatNum(item.close)} icon={<Target size={15} />} />
                    <MetricTile styles={styles} title="RSI" value={formatNum(item.rsi)} note={`R/R ${formatNum(item.risk_reward_ratio)}`} icon={<Activity size={15} />} />
                    <MetricTile styles={styles} title="MACD" value={formatNum(item.macd)} note={`Signal ${formatNum(item.macd_signal)}`} icon={<TrendingUp size={15} />} />
                    <MetricTile styles={styles} title="Volume" value={formatNum(item.volume_ratio)} note={`MA20 ${formatNum(item.volume_ma20)}`} icon={<BarChart3 size={15} />} />
                  </div>
                </article>
              ))}
            </section>
          )}

          <section style={styles.compactCard}>
            <div style={styles.compactHeader}>
              <div style={styles.compactTitle}>Cập nhật dữ liệu</div>
              <div style={styles.compactSub}>{jobRunning ? "Đang chạy" : formatDateTime(latestMarketTime) || "Sẵn sàng"}</div>
            </div>

            <div style={styles.updateGrid}>
              <button style={styles.secondaryButton} onClick={() => runUpdate("stocks")} disabled={jobRunning}><RefreshCw size={16} /><span>Cổ phiếu</span></button>
              <button style={styles.secondaryButton} onClick={() => runUpdate("gold")} disabled={jobRunning}><Gem size={16} /><span>Vàng</span></button>
              <button style={styles.secondaryButton} onClick={() => runUpdate("fuel")} disabled={jobRunning}><Fuel size={16} /><span>Xăng</span></button>
              <button style={styles.primaryButtonWide} onClick={() => runUpdate("all")} disabled={jobRunning}><RefreshCw size={16} /><span>Tất cả</span></button>
            </div>

            {jobStatus ? (
              <div style={styles.slimProgressWrap}>
                <div style={styles.rowBetween}>
                  <div style={styles.slimLabel}>{jobStatus.message || "Đang xử lý..."}</div>
                  <div style={styles.progressText}>{Number(jobStatus.progress || 0)}%</div>
                </div>
                <div style={styles.progressTrack}><div style={{ ...styles.progressBar, width: `${Number(jobStatus.progress || 0)}%` }} /></div>
              </div>
            ) : null}
          </section>

          <section style={styles.miniStatusGrid}>
            <MiniStatusCard styles={styles} title="Cập nhật thị trường" value={formatDateTime(latestMarketTime)} />
            <MiniStatusCard styles={styles} title="Giá vàng mới nhất" value={formatDateTime(latestGoldSourceTime)} />
            <MiniStatusCard styles={styles} title="Đồng bộ giá vàng" value={formatDateTime(latestGoldSyncTime)} />
            <MiniStatusCard styles={styles} title="Giá xăng hiệu lực" value={formatDateTime(latestFuelTime)} />
          </section>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ styles, text }) {
  return <div style={styles.sectionTitle}>{text}</div>;
}

function HeroStat({ styles, label, value }) {
  return (
    <div style={styles.heroStat}>
      <div style={styles.heroStatLabel}>{label}</div>
      <div style={styles.heroStatValue}>{value}</div>
    </div>
  );
}

function MiniStatusCard({ styles, title, value }) {
  return (
    <div style={styles.miniStatusCard}>
      <div style={styles.miniStatusLabel}>{title}</div>
      <div style={styles.miniStatusValue}>{value || "Chưa có dữ liệu"}</div>
    </div>
  );
}

function MetricTile({ styles, title, value, note, icon }) {
  return (
    <div style={styles.metricTile}>
      <div style={styles.metricTop}>
        <div style={styles.metricLabel}>{title}</div>
        <div style={styles.metricIcon}>{icon}</div>
      </div>
      <div style={styles.metricValue}>{value}</div>
      {note ? <div style={styles.metricNote}>{note}</div> : null}
    </div>
  );
}

function MiniMetric({ styles, title, value, icon }) {
  return (
    <div style={styles.miniMetric}>
      <div style={styles.metricTop}>
        <div style={styles.metricLabel}>{title}</div>
        <div style={styles.metricIcon}>{icon}</div>
      </div>
      <div style={styles.miniMetricValue}>{value}</div>
    </div>
  );
}

function InfoStrip({ styles, label, value }) {
  return (
    <div style={styles.infoStrip}>
      <div style={styles.infoStripLabel}>{label}</div>
      <div style={styles.infoStripValue}>{value}</div>
    </div>
  );
}

function sortFuelItems(items) {
  const order = ["RON95-V", "RON95-III", "E5 RON92-II", "E10 RON95-III", "Diesel 0.001S-V", "Diesel 0.05S-II", "Dầu hỏa 2-K"];
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
  return d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + " GMT+7";
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
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatGoldChange(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const num = Number(value);
  if (unit === "VND/lượng") {
    if (Math.abs(num) < 1000) return "";
    return `${num > 0 ? "+" : "-"}${Math.abs(Math.round(num)).toLocaleString("vi-VN")}`;
  }
  if (Math.abs(num) < 0.01) return "";
  return `${num > 0 ? "+" : "-"}${Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const hasZone = hasMeaningfulNumber(item.entry_zone_low) && hasMeaningfulNumber(item.entry_zone_high);
  const hasRisk = hasMeaningfulNumber(item.stop_loss) || hasMeaningfulNumber(item.risk_reward_ratio) || hasMeaningfulNumber(item.trailing_stop);
  const hasTargets = hasMeaningfulNumber(item.take_profit_1) || hasMeaningfulNumber(item.take_profit_2);
  const hasSize = hasMeaningfulNumber(item.position_size_pct);
  return hasZone || hasRisk || hasTargets || hasSize;
}

function getPalette(theme) {
  if (theme === "dark") {
    return {
      bg: "#071018",
      bg2: "#0b1520",
      surface: "rgba(14, 22, 34, 0.74)",
      surfaceStrong: "rgba(17, 28, 42, 0.92)",
      surfaceSoft: "rgba(20, 31, 46, 0.78)",
      line: "rgba(148, 163, 184, 0.16)",
      lineStrong: "rgba(148, 163, 184, 0.22)",
      text: "#f8fafc",
      subtext: "#d9e2ee",
      muted: "#94a3b8",
      primary: "#0a84ff",
      primaryStrong: "#0066d6",
      success: "#22c55e",
      danger: "#ef4444",
      orange: "#f97316",
      shadow: "rgba(2, 8, 23, 0.42)",
      glass: "blur(18px)",
      sans: "'Be Vietnam Pro', Inter, Arial, sans-serif",
    };
  }
  return {
    bg: "#eef3fb",
    bg2: "#f7f9fd",
    surface: "rgba(255, 255, 255, 0.72)",
    surfaceStrong: "rgba(255, 255, 255, 0.94)",
    surfaceSoft: "rgba(248, 250, 252, 0.9)",
    line: "rgba(148, 163, 184, 0.20)",
    lineStrong: "rgba(148, 163, 184, 0.28)",
    text: "#0f172a",
    subtext: "#334155",
    muted: "#64748b",
    primary: "#0a84ff",
    primaryStrong: "#0066d6",
    success: "#16a34a",
    danger: "#dc2626",
    orange: "#ea580c",
    shadow: "rgba(15, 23, 42, 0.10)",
    glass: "blur(16px)",
    sans: "'Be Vietnam Pro', Inter, Arial, sans-serif",
  };
}

function createStyles(p, isMobile) {
  return {
    page: { minHeight: "100vh", background: `linear-gradient(180deg, ${p.bg}, ${p.bg2})`, padding: isMobile ? 12 : 20, position: "relative", overflowX: "hidden", fontFamily: p.sans },
    glowOne: { position: "fixed", top: -40, left: -50, width: 220, height: 220, borderRadius: "50%", background: "rgba(10,132,255,0.16)", filter: "blur(80px)", pointerEvents: "none" },
    glowTwo: { position: "fixed", right: -60, bottom: -40, width: 260, height: 260, borderRadius: "50%", background: "rgba(125, 211, 252, 0.14)", filter: "blur(90px)", pointerEvents: "none" },
    shell: { maxWidth: 1280, margin: "0 auto", position: "relative", zIndex: 1, display: "grid", gap: 14 },
    hero: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 32, padding: isMobile ? 16 : 20, backdropFilter: p.glass, boxShadow: `0 20px 40px ${p.shadow}` },
    heroTop: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 14, alignItems: "start" },
    heroEyebrow: { color: p.primary, fontSize: 12, lineHeight: 1.4, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 12 },
    themeButton: { width: 46, height: 46, borderRadius: 16, border: `1px solid ${p.line}`, background: p.surfaceStrong, color: p.text, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: `0 10px 22px ${p.shadow}`, backdropFilter: p.glass },
    heroStats: { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 },
    heroStat: { background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 20, padding: 14, backdropFilter: p.glass },
    heroStatLabel: { color: p.muted, fontSize: 12, lineHeight: 1.4, fontWeight: 700, marginBottom: 8 },
    heroStatValue: { color: p.text, fontSize: isMobile ? 22 : 26, lineHeight: 1.1, fontWeight: 800 },
    segmentWrap: { display: "flex", flexWrap: "wrap", gap: 8, padding: 6, borderRadius: 999, background: p.surface, border: `1px solid ${p.line}`, backdropFilter: p.glass, boxShadow: `0 16px 30px ${p.shadow}`, width: "fit-content", maxWidth: "100%" },
    segment: { border: "none", background: "transparent", color: p.subtext, padding: "10px 14px", borderRadius: 999, cursor: "pointer", fontSize: 14, lineHeight: 1.4, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 },
    segmentActive: { border: "none", background: p.surfaceStrong, color: p.text, padding: "10px 14px", borderRadius: 999, cursor: "pointer", fontSize: 14, lineHeight: 1.4, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, boxShadow: `0 8px 18px ${p.shadow}` },
    glassCard: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 28, padding: isMobile ? 16 : 18, backdropFilter: p.glass, boxShadow: `0 18px 34px ${p.shadow}` },
    compactCard: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 24, padding: 14, backdropFilter: p.glass, boxShadow: `0 14px 28px ${p.shadow}` },
    compactHeader: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 8, alignItems: "center" },
    compactTitle: { color: p.text, fontSize: 18, lineHeight: 1.2, fontWeight: 800 },
    compactSub: { color: p.muted, fontSize: 12, lineHeight: 1.4, textAlign: isMobile ? "left" : "right" },
    toolbarTop: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 10, alignItems: "center" },
    toolbarNote: { color: p.muted, fontSize: 12, lineHeight: 1.4, textAlign: isMobile ? "left" : "right" },
    toolbarRow: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr", gap: 12, marginTop: 14 },
    inputShell: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 10 },
    input: { width: "100%", boxSizing: "border-box", padding: "15px 16px", borderRadius: 20, border: `1px solid ${p.lineStrong}`, background: p.surfaceStrong, color: p.text, fontSize: 14, lineHeight: 1.4, outline: "none", fontFamily: p.sans, backdropFilter: p.glass },
    searchInput: { width: "100%", boxSizing: "border-box", padding: "15px 16px", borderRadius: 20, border: `1px solid ${p.lineStrong}`, background: p.surfaceStrong, color: p.text, fontSize: 14, lineHeight: 1.4, outline: "none", fontFamily: p.sans, backdropFilter: p.glass },
    addButton: { border: "none", background: `linear-gradient(135deg, ${p.primary}, ${p.primaryStrong})`, color: "#fff", padding: "0 16px", borderRadius: 20, cursor: "pointer", fontSize: 14, lineHeight: 1.4, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, boxShadow: `0 14px 28px ${p.shadow}` },
    stockGrid: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 },
    stockCard: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 28, padding: isMobile ? 16 : 18, backdropFilter: p.glass, boxShadow: `0 18px 34px ${p.shadow}`, minWidth: 0 },
    stockCardTop: { display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" },
    stockSymbolRow: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
    stockTitle: { color: p.text, fontSize: isMobile ? 26 : 30, lineHeight: 1.05, fontWeight: 800, letterSpacing: -0.5 },
    cardTopActions: { display: "flex", alignItems: "flex-start", gap: 8 },
    scoreBadge: { background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 18, padding: "10px 12px", minWidth: 94, textAlign: "right" },
    scoreBadgeLabel: { color: p.muted, fontSize: 11, lineHeight: 1.4, fontWeight: 700 },
    scoreBadgeValue: { color: p.text, fontSize: 22, lineHeight: 1.1, fontWeight: 800, marginTop: 4 },
    iconDangerButton: { width: 38, height: 38, borderRadius: 14, border: "none", background: "rgba(239,68,68,0.12)", color: p.danger, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
    iconBadge: { width: 38, height: 38, borderRadius: 14, background: p.surfaceStrong, border: `1px solid ${p.line}`, color: p.muted, display: "inline-flex", alignItems: "center", justifyContent: "center" },
    badgeRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, marginBottom: 14 },
    actionBuy: { background: "rgba(34,197,94,0.14)", color: p.success, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 },
    actionHold: { background: "rgba(10,132,255,0.14)", color: p.primary, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 },
    actionTp: { background: "rgba(249,115,22,0.14)", color: p.orange, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 },
    actionSell: { background: "rgba(239,68,68,0.14)", color: p.danger, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 },
    actionWatch: { background: "rgba(245,158,11,0.16)", color: "#b45309", borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 },
    softPill: { background: p.surfaceStrong, border: `1px solid ${p.line}`, color: p.subtext, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
    softPillBlue: { background: "rgba(10,132,255,0.12)", color: p.primary, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
    softPillGreen: { background: "rgba(34,197,94,0.12)", color: p.success, borderRadius: 999, padding: "8px 12px", fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
    metricsRow: { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 },
    metricTile: { background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 20, padding: 14, minWidth: 0 },
    metricTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
    metricIcon: { color: p.muted, display: "inline-flex", alignItems: "center", justifyContent: "center" },
    metricLabel: { color: p.muted, fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
    metricValue: { color: p.text, fontSize: 18, lineHeight: 1.2, fontWeight: 800, wordBreak: "break-word" },
    metricNote: { color: p.muted, fontSize: 12, lineHeight: 1.55, marginTop: 6, wordBreak: "break-word" },
    bottomInfoGrid: { display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 10 },
    infoStrip: { background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 16, padding: "12px 14px" },
    infoStripLabel: { color: p.muted, fontSize: 12, lineHeight: 1.4, fontWeight: 700, marginBottom: 6 },
    infoStripValue: { color: p.subtext, fontSize: 13, lineHeight: 1.6, fontWeight: 700, wordBreak: "break-word" },
    subCard: { marginTop: 12, background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 22, padding: 14 },
    subCardTitle: { color: p.text, fontSize: 18, lineHeight: 1.2, fontWeight: 800, marginBottom: 10 },
    tradePlanGrid: { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))", gap: 10 },
    miniMetric: { background: p.surfaceSoft, border: `1px solid ${p.line}`, borderRadius: 16, padding: 12, minWidth: 0 },
    miniMetricValue: { color: p.text, fontSize: 14, lineHeight: 1.45, fontWeight: 800, wordBreak: "break-word" },
    noteCard: { marginTop: 12, background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 20, padding: 14 },
    noteTitle: { color: p.text, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, lineHeight: 1.5, fontWeight: 800, marginBottom: 8 },
    noteText: { color: p.subtext, fontSize: 14, lineHeight: 1.7 },
    sectionTitle: { color: p.text, fontSize: isMobile ? 26 : 30, lineHeight: 1.08, fontWeight: 800, letterSpacing: -0.4 },
    dualGrid: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 },
    singleHeroMetric: { background: p.surfaceStrong, border: `1px solid ${p.line}`, borderRadius: 22, padding: 18, marginTop: 8 },
    heroNumber: { color: p.text, fontSize: isMobile ? 28 : 34, lineHeight: 1.08, fontWeight: 800 },
    heroNumberGreen: { color: p.success, fontSize: isMobile ? 28 : 34, lineHeight: 1.08, fontWeight: 800, marginTop: 8 },
    changeUp: { marginTop: 10, color: p.success, fontSize: 14, lineHeight: 1.5, fontWeight: 800, minHeight: 21 },
    changeDown: { marginTop: 10, color: p.danger, fontSize: 14, lineHeight: 1.5, fontWeight: 800, minHeight: 21 },
    changeNeutral: { marginTop: 10, color: p.muted, fontSize: 14, lineHeight: 1.5, fontWeight: 700, minHeight: 21 },
    updateGrid: { display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, max-content)", gap: 10, marginTop: 12, alignItems: "stretch" },
    secondaryButton: { border: `1px solid ${p.line}`, background: p.surfaceStrong, color: p.text, padding: "12px 14px", borderRadius: 18, cursor: "pointer", fontSize: 14, lineHeight: 1.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: `0 8px 18px ${p.shadow}`, fontFamily: p.sans, backdropFilter: p.glass },
    primaryButtonWide: { border: "none", background: `linear-gradient(135deg, ${p.primary}, ${p.primaryStrong})`, color: "#fff", padding: "12px 16px", borderRadius: 18, cursor: "pointer", fontSize: 14, lineHeight: 1.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: `0 12px 24px ${p.shadow}`, fontFamily: p.sans },
    slimProgressWrap: { marginTop: 12 },
    slimLabel: { color: p.subtext, fontSize: 12, lineHeight: 1.5 },
    rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
    progressText: { color: p.primary, fontSize: 13, lineHeight: 1.5, fontWeight: 800 },
    progressTrack: { width: "100%", height: 8, background: "rgba(148,163,184,0.22)", borderRadius: 999, overflow: "hidden" },
    progressBar: { height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${p.primary}, ${p.primaryStrong})`, transition: "width 0.35s ease" },
    miniStatusGrid: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 },
    miniStatusCard: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 20, padding: 14, boxShadow: `0 12px 24px ${p.shadow}`, backdropFilter: p.glass },
    miniStatusLabel: { color: p.muted, fontSize: 11, lineHeight: 1.4, fontWeight: 700, marginBottom: 6 },
    miniStatusValue: { color: p.text, fontSize: 13, lineHeight: 1.5, fontWeight: 700, wordBreak: "break-word" },
  };
}
