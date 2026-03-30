import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase.rpc("version");
    const { count: goldCount, error: goldError } = await supabase
      .from("gold_prices")
      .select("*", { count: "exact", head: true });

    const { count: fuelCount, error: fuelError } = await supabase
      .from("fuel_prices")
      .select("*", { count: "exact", head: true });

    const { count: stockCount, error: stockError } = await supabase
      .from("stock_signals")
      .select("*", { count: "exact", head: true });

    return res.status(200).json({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      goldCount,
      fuelCount,
      stockCount,
      goldError: goldError?.message || null,
      fuelError: fuelError?.message || null,
      stockError: stockError?.message || null,
      versionData: data || null,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
