// pages/api/screener.js
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

const FUNDAMENTAL_COLUMNS = [
  "symbol",
  "company_name",
  "industry",
  "exchange",
  "market_cap",
  "pe",
  "pb",
  "roe",
  "roa",
  "eps",
  "revenue_growth",
  "profit_growth",
  "debt_to_equity",
  "updated_at",
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

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function passesDefaultFilter(item) {
  const f = item.fundamental || {};

  const score = toNumber(item.total_score);
  const rsi = toNumber(item.rsi);
  const pe = toNumber(f.pe);
  const pb = toNumber(f.pb);
  const roe = toNumber(f.roe);

  const scoreOk = score != null && score >= 55;
  const rsiOk = rsi == null || (rsi >= 50 && rsi <= 70);
  const peOk = pe == null || pe < 20;
  const pbOk = pb == null || pb < 3.5;
  const roeOk = roe == null || roe > 12;

  return scoreOk && rsiOk && peOk && pbOk && roeOk;
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

    const signalResults = await runInBatches(symbols, 10, (symbol) =>
      getLatestSignalBySymbol(supabase, symbol)
    );

    const latestSignals = signalResults
      .filter((x) => !x.error && x.row)
      .map((x) => x.row);

    const { data: fundamentals, error: fundamentalsError } = await supabase
      .from("company_fundamentals")
      .select(FUNDAMENTAL_COLUMNS)
      .in("symbol", symbols);

    if (fundamentalsError) {
      return res.status(500).json({ error: fundamentalsError.message });
    }

    const fundamentalsMap = Object.fromEntries(
      (fundamentals || []).map((f) => [f.symbol, f])
    );

    const merged = latestSignals.map((signal) => ({
      ...signal,
      fundamental: fundamentalsMap[signal.symbol] || null,
    }));

    const filtered = merged
      .filter(passesDefaultFilter)
      .sort((a, b) => {
        const scoreDiff = (b.total_score || 0) - (a.total_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.ts).getTime() - new Date(a.ts).getTime();
      });

    return res.status(200).json(filtered);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
