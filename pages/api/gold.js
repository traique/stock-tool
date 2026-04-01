const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GOLD_ORDER = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];

function pickLatestByType(rows) {
  const latestMap = new Map();

  for (const row of rows) {
    if (!row || !row.gold_type) continue;
    if (!GOLD_ORDER.includes(row.gold_type)) continue;
    if (!latestMap.has(row.gold_type)) {
      latestMap.set(row.gold_type, row);
    }
  }

  return GOLD_ORDER.map((key) => latestMap.get(key)).filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const { data, error } = await supabase
      .from("gold_prices")
      .select(
        "id, source, gold_type, display_name, subtitle, buy_price, sell_price, unit, change_buy, change_sell, price_time, created_at"
      )
      .in("gold_type", GOLD_ORDER)
      .order("price_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    const latestRows = pickLatestByType(data || []);

    return res.status(200).json(latestRows);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
};
