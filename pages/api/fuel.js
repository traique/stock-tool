import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      return res.status(500).json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error, count } = await supabase
      .from("fuel_prices")
      .select("*", { count: "exact" })
      .order("effective_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message,
        where: "fuel_prices",
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
      debug_using_service_role: true,
      debug_project_url: supabaseUrl,
      debug_total_rows: count ?? (data || []).length,
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
