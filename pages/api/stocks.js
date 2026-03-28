import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("stocks")
        .select("*")
        .order("symbol", { ascending: true });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    if (req.method === "POST") {
      const { symbol } = req.body || {};
      if (!symbol) return res.status(400).json({ error: "Thiếu symbol" });

      const clean = String(symbol).trim().toUpperCase();

      const { error } = await supabase
        .from("stocks")
        .insert([{ symbol: clean }]);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, symbol: clean });
    }

    if (req.method === "DELETE") {
      const { symbol } = req.body || {};
      if (!symbol) return res.status(400).json({ error: "Thiếu symbol" });

      const clean = String(symbol).trim().toUpperCase();

      await supabase.from("stocks").delete().eq("symbol", clean);
      await supabase.from("price_bars").delete().eq("symbol", clean);
      await supabase.from("stock_signals").delete().eq("symbol", clean);
      await supabase.from("company_fundamentals").delete().eq("symbol", clean);

      return res.status(200).json({ ok: true, symbol: clean });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
        }
