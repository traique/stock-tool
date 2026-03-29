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

    const rows = latestSignals
      .filter(Boolean)
      .sort((a, b) => {
        const scoreDiff = Number(b.total_score || 0) - Number(a.total_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.ts).getTime() - new Date(a.ts).getTime();
      });

    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
      where: "handler",
    });
  }
}
