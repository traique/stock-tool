import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SIGNAL_COLUMNS = `
  symbol,
  ts,
  created_at,
  close,
  rsi,
  ma20,
  ma50,
  ma100,
  macd,
  macd_signal,
  macd_hist,
  volume_ma20,
  volume_ratio,
  distance_ma20,
  bullish_ma,
  bullish_macd,
  breakout_20,
  breakout_55,
  overbought,
  oversold,
  price_action,
  technical_score,
  momentum_score,
  breakout_score,
  total_score,
  expert_note,
  signal_action,
  signal_strength,
  setup_type,
  entry_price,
  entry_zone_low,
  entry_zone_high,
  stop_loss,
  take_profit_1,
  take_profit_2,
  trailing_stop,
  risk_reward_ratio,
  position_size_pct,
  confidence_score,
  expert_strategy_note
`;

const FUNDAMENTAL_COLUMNS = `
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
  updated_at
`;

async function getLatestSignalBySymbol(symbol) {
  const { data, error } = await supabase
    .from("stock_signals")
    .select(SIGNAL_COLUMNS)
    .eq("symbol", symbol)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data || null;
}

async function runInBatches(items, batchSize, task) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(task));
    results.push(...batchResults);
  }

  return results;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function defaultScreenerFilter(item) {
  const f = item.fundamental || {};

  const totalScore = toNumber(item.total_score);
  const confidence = toNumber(item.confidence_score);
  const rr = toNumber(item.risk_reward_ratio);
  const rsi = toNumber(item.rsi);
  const pe = toNumber(f.pe);
  const pb = toNumber(f.pb);
  const roe = toNumber(f.roe);

  const signalAction = String(item.signal_action || "").toUpperCase();
  const signalStrength = String(item.signal_strength || "").toUpperCase();

  const actionOk = ["BUY", "HOLD", "WATCH"].includes(signalAction);
  const scoreOk = totalScore == null || totalScore >= 45;
  const confidenceOk = confidence == null || confidence >= 60;
  const rrOk = rr == null || rr >= 1.5;
  const rsiOk = rsi == null || (rsi >= 45 && rsi <= 75);
  const peOk = pe == null || pe <= 25;
  const pbOk = pb == null || pb <= 4.5;
  const roeOk = roe == null || roe >= 10;
  const strengthPenalty = signalStrength !== "WEAK";

  return actionOk && scoreOk && confidenceOk && rrOk && rsiOk && peOk && pbOk && roeOk && strengthPenalty;
}

function sortScreener(a, b) {
  const actionPriority = {
    BUY: 5,
    HOLD: 4,
    WATCH: 3,
    TAKE_PROFIT: 2,
    SELL: 1,
    CUT_LOSS: 0,
  };

  const actionDiff =
    (actionPriority[String(b.signal_action || "").toUpperCase()] || 0) -
    (actionPriority[String(a.signal_action || "").toUpperCase()] || 0);

  if (actionDiff !== 0) return actionDiff;

  const confidenceDiff = Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
  if (confidenceDiff !== 0) return confidenceDiff;

  const rrDiff = Number(b.risk_reward_ratio || 0) - Number(a.risk_reward_ratio || 0);
  if (rrDiff !== 0) return rrDiff;

  const scoreDiff = Number(b.total_score || 0) - Number(a.total_score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  return new Date(b.ts).getTime() - new Date(a.ts).getTime();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data: stocks, error: stocksError } = await supabase
      .from("stocks")
      .select("symbol")
      .order("symbol", { ascending: true });

    if (stocksError) {
      return res.status(500).json({ error: stocksError.message, where: "stocks" });
    }

    const symbols = (stocks || [])
      .map((x) => String(x.symbol || "").trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      return res.status(200).json([]);
    }

    const latestSignals = await runInBatches(symbols, 10, getLatestSignalBySymbol);

    const filteredSignals = latestSignals.filter(Boolean);

    const { data: fundamentals, error: fundamentalsError } = await supabase
      .from("company_fundamentals")
      .select(FUNDAMENTAL_COLUMNS)
      .in("symbol", symbols);

    if (fundamentalsError) {
      return res.status(500).json({
        error: fundamentalsError.message,
        where: "company_fundamentals",
      });
    }

    const fundamentalMap = Object.fromEntries(
      (fundamentals || []).map((row) => [row.symbol, row])
    );

    const merged = filteredSignals.map((signal) => ({
      ...signal,
      fundamental: fundamentalMap[signal.symbol] || null,
    }));

    const screened = merged.filter(defaultScreenerFilter).sort(sortScreener);

    return res.status(200).json(screened);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
      where: "handler",
    });
  }
}
