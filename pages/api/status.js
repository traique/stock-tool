import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data: latestSignal, error: signalError } = await supabase
      .from("stock_signals")
      .select("symbol, ts, created_at")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (signalError) {
      return res.status(500).json({ error: signalError.message, where: "stock_signals" });
    }

    const { data: systemStatus, error: statusError } = await supabase
      .from("system_status")
      .select("job_name, last_run_at, last_success_at, last_market_ts, updated_at")
      .eq("job_name", "price_update")
      .maybeSingle();

    if (statusError) {
      return res.status(500).json({ error: statusError.message, where: "system_status" });
    }

    return res.status(200).json({
      last_updated: systemStatus?.last_market_ts || latestSignal?.ts || null,
      latest_signal_ts: latestSignal?.ts || null,
      latest_symbol: latestSignal?.symbol || null,
      db_written_at: latestSignal?.created_at || null,
      github_update_at: systemStatus?.last_run_at || null,
      github_success_at: systemStatus?.last_success_at || null,
      debug_has_system_status: !!systemStatus,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
      where: "handler",
    });
  }
}
