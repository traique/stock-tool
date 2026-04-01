import { createClient } from "@supabase/supabase-js";

const GOLD_ORDER = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("gold_prices")
      .select("*")
      .order("id", { ascending: false })
      .limit(200);

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    const rows = Array.isArray(data) ? data : [];

    const result = [];
    for (const type of GOLD_ORDER) {
      const found = rows.find((row) => row && row.gold_type === type);
      if (found) result.push(found);
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
