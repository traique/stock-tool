import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("stock_signals")
      .select("*")
      .order("ts", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const latestBySymbol = [];
    const seen = new Set();

    for (const row of data || []) {
      if (!seen.has(row.symbol)) {
        seen.add(row.symbol);
        latestBySymbol.push(row);
      }
    }

    res.status(200).json(latestBySymbol);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
