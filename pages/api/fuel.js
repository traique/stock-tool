import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("fuel_prices")
      .select("*")
      .order("effective_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const latestMap = new Map();
    for (const row of data || []) {
      if (!latestMap.has(row.fuel_type)) {
        latestMap.set(row.fuel_type, row);
      }
    }

    return res.status(200).json(Array.from(latestMap.values()));
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
