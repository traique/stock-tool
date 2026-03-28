// pages/api/status.js
import { getSupabaseServerClient } from "../../lib/supabaseServer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("stock_signals")
      .select("symbol, ts, created_at")
      .order("ts", { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(200).json({
        last_updated: null,
        latest_signal_ts: null,
        latest_symbol: null,
        db_written_at: null,
      });
    }

    const latest = data[0];

    return res.status(200).json({
      last_updated: latest.ts,
      latest_signal_ts: latest.ts,
      latest_symbol: latest.symbol,
      db_written_at: latest.created_at ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
