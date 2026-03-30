import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      return res.status(500).json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" });
    }

    if (!supabaseKey) {
      return res.status(500).json({ error: "Missing Supabase key" });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("gold_prices")
      .select("*")
      .order("price_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message,
        where: "gold_prices",
        debug_project_url: supabaseUrl,
      });
    }

    const wanted = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];
    const latestMap = new Map();

    for (const row of data || []) {
      if (wanted.includes(row.gold_type) && !latestMap.has(row.gold_type)) {
        latestMap.set(row.gold_type, row);
      }
    }

    let ordered = wanted.map((key) => latestMap.get(key)).filter(Boolean);

    if (ordered.length === 0) {
      ordered = (data || []).slice(0, 5);
    }

    return res.status(200).json({
      debug_project_url: supabaseUrl,
      debug_total_rows: (data || []).length,
      debug_returned_rows: ordered.length,
      items: ordered,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
      where: "handler",
    });
  }
}
