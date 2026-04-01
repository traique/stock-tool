const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GOLD_ORDER = ["sjc_hcm", "ring_9999_hcm", "world_xauusd"];

function toMillis(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortNewest(a, b) {
  const ta = toMillis(a.price_time || a.created_at);
  const tb = toMillis(b.price_time || b.created_at);

  if (tb !== ta) return tb - ta;
  return Number(b.id || 0) - Number(a.id || 0);
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
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("gold_prices")
      .select(
        "id, source, gold_type, display_name, subtitle, buy_price, sell_price, unit, change_buy, change_sell, price_time, created_at"
      )
      .in("gold_type", GOLD_ORDER)
      .order("id", { ascending: false })
      .limit(200);

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    const rows = Array.isArray(data) ? data : [];

    const grouped = {};
    for (const type of GOLD_ORDER) {
      grouped[type] = rows
        .filter((row) => row && row.gold_type === type)
        .sort(sortNewest);
    }

    const result = GOLD_ORDER.map((type) => grouped[type][0]).filter(Boolean);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
};
