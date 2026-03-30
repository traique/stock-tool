import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("gold_prices")
      .select("*")
      .order("price_time", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const wanted = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];
    const latestMap = new Map();

    for (const row of data || []) {
      if (!wanted.includes(row.gold_type)) continue;
      if (!latestMap.has(row.gold_type)) {
        latestMap.set(row.gold_type, row);
      }
    }

    const ordered = wanted
      .map((key) => latestMap.get(key))
      .filter(Boolean);

    return res.status(200).json(ordered);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
