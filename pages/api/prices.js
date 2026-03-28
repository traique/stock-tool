// pages/api/prices.js
import { getSupabaseServerClient } from "../../lib/supabaseServer";

const SIGNAL_COLUMNS = [
  "symbol",
  "ts",
  "close",
  "rsi",
  "ma20",
  "ma50",
  "ma100",
  "macd",
  "macd_signal",
  "volume_ma20",
  "volume_ratio",
  "distance_ma20",
  "bullish_ma",
  "bullish_macd",
  "breakout_20",
  "breakout_55",
  "overbought",
  "oversold",
  "price_action",
  "technical_score",
  "momentum_score",
  "breakout_score",
  "total_score",
  "expert_note",
  "created_at",
].join(", ");

async function runInBatches(items, batchSize, task) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map(task));
    results.push(...chunkResults);
  }

  return results;
}

async function getLatestSignalBySymbol(supabase, symbol) {
  const { data, error } = await supabase
    .from("stock_signals")
    .select(SIGNAL_COLUMNS)
    .eq("symbol", symbol)
    .order("ts", { ascending: false })
    .limit(1);

  if (error) {
    return { symbol, error: error.message, row: null };
  }

  return { symbol, error: null, row: data?.[0] || null };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: stocks, error: stocksError } = await supabase
      .from("stocks")
      .select("symbol")
      .order("symbol", { ascending: true });

    if (stocksError) {
      return res.status(500).json({ error: stocksError.message });
    }

    const symbols = (stocks || [])
      .map((x) => String(x.symbol || "").trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      return res.status(200).json([]);
    }

    const results = await runInBatches(symbols, 10, (symbol) =>
      getLatestSignalBySymbol(supabase, symbol)
    );

    const rows = results
      .filter((x) => !x.error && x.row)
      .map((x) => x.row)
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
