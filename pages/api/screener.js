import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data: signals, error: signalsError } = await supabase
      .from("stock_signals")
      .select("*")
      .order("ts", { ascending: false });

    if (signalsError) {
      return res.status(500).json({ error: signalsError.message });
    }

    const { data: fundamentals, error: fundamentalsError } = await supabase
      .from("company_fundamentals")
      .select("*");

    if (fundamentalsError) {
      return res.status(500).json({ error: fundamentalsError.message });
    }

    const latestBySymbol = [];
    const seen = new Set();

    for (const row of signals || []) {
      if (!seen.has(row.symbol)) {
        seen.add(row.symbol);
        latestBySymbol.push(row);
      }
    }

    const fundamentalsMap = {};
    for (const f of fundamentals || []) {
      fundamentalsMap[f.symbol] = f;
    }

    const merged = latestBySymbol.map((s) => ({
      ...s,
      fundamental: fundamentalsMap[s.symbol] || null,
    }));

    const filtered = merged
      .filter((x) => {
        const f = x.fundamental || {};
        const rsiOk = x.rsi == null || (x.rsi >= 50 && x.rsi <= 70);
        const peOk = f.pe == null || f.pe < 20;
        const pbOk = f.pb == null || f.pb < 3.5;
        const roeOk = f.roe == null || f.roe > 12;
        const scoreOk = x.total_score != null && x.total_score >= 55;

        return scoreOk && rsiOk && peOk && pbOk && roeOk;
      })
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

    res.status(200).json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
