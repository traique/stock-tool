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
      .from("fuel_prices")
      .select("*")
      .order("effective_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message,
        where: "fuel_prices",
        debug_project_url: supabaseUrl,
      });
    }

    const latestMap = new Map();
    for (const row of data || []) {
      if (!latestMap.has(row.fuel_type)) {
        latestMap.set(row.fuel_type, row);
      }
    }

    const items = Array.from(latestMap.values());

    return res.status(200).json({
      debug_project_url: supabaseUrl,
      debug_total_rows: (data || []).length,
      debug_returned_rows: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
      where: "handler",
    });
  }
}
