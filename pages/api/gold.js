const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
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
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("gold_prices")
      .select("*")
      .order("id", { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    const rows = Array.isArray(data) ? data : [];

    const pickLatest = (type) => rows.find((r) => r && r.gold_type === type) || null;

    const result = [
      pickLatest("sjc_hcm"),
      pickLatest("ring_9999_hcm"),
      pickLatest("world_xauusd"),
    ].filter(Boolean);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
};
