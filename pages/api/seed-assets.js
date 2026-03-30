import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from("gold_prices").delete().neq("id", 0);
    await supabase.from("fuel_prices").delete().neq("id", 0);

    const now = new Date().toISOString();

    const { error: goldError } = await supabase.from("gold_prices").insert([
      {
        source: "manual",
        gold_type: "sjc_hcm",
        display_name: "Vàng miếng SJC",
        subtitle: "SJC - Hồ Chí Minh",
        buy_price: 169800000,
        sell_price: 172800000,
        unit: "VND/lượng",
        change_buy: 1200000,
        change_sell: 1200000,
        price_time: now,
      },
      {
        source: "manual",
        gold_type: "ring_9999_hcm",
        display_name: "Vàng nhẫn 9999",
        subtitle: "SJC - Hồ Chí Minh",
        buy_price: 169600000,
        sell_price: 172600000,
        unit: "VND/lượng",
        change_buy: 1200000,
        change_sell: 1200000,
        price_time: now,
      },
      {
        source: "manual",
        gold_type: "world_xauusd",
        display_name: "Vàng thế giới",
        subtitle: "Vàng/Đô la Mỹ",
        buy_price: 4433.01,
        sell_price: 4433.01,
        unit: "USD/ounce",
        change_buy: -52.39,
        change_sell: -52.39,
        price_time: now,
      },
    ]);

    const { error: fuelError } = await supabase.from("fuel_prices").insert([
      { fuel_type: "RON95-V", price: 24730, unit: "VND/liter", effective_time: now },
      { fuel_type: "RON95-III", price: 24330, unit: "VND/liter", effective_time: now },
      { fuel_type: "E10 RON95-III", price: 23690, unit: "VND/liter", effective_time: now },
      { fuel_type: "E5 RON92-II", price: 23320, unit: "VND/liter", effective_time: now },
      { fuel_type: "Diesel 0.001S-V", price: 35640, unit: "VND/liter", effective_time: now },
      { fuel_type: "Diesel 0.05S-II", price: 35440, unit: "VND/liter", effective_time: now },
      { fuel_type: "Dầu hỏa 2-K", price: 35380, unit: "VND/liter", effective_time: now },
    ]);

    return res.status(200).json({
      ok: true,
      goldError: goldError?.message || null,
      fuelError: fuelError?.message || null,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
