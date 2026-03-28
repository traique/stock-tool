import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("stock_signals")
      .select("symbol, ts, created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });

    if (!data || data.length === 0) {
      return res.status(200).json({ last_updated: null });
    }

    return res.status(200).json({
      last_updated: data[0].created_at,
      latest_signal_ts: data[0].ts,
      latest_symbol: data[0].symbol,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
