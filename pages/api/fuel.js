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
      .from("fuel_prices")
      .select("*")
      .order("effective_time", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const latestMap = new Map();
    for (const row of data || []) {
      const key = row.fuel_type;
      if (!latestMap.has(key)) {
        latestMap.set(key, row);
      }
    }

    return res.status(200).json(Array.from(latestMap.values()));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
