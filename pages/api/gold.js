import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("gold_prices")
      .select("*")
      .order("price_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const wanted = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];
    const latestMap = new Map();

    for (const row of data || []) {
      if (wanted.includes(row.gold_type) && !latestMap.has(row.gold_type)) {
        latestMap.set(row.gold_type, row);
      }
    }

    const items = wanted.map((key) => latestMap.get(key)).filter(Boolean);

    return res.status(200).json(items);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
