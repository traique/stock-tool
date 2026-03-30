import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const { id } = req.query;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    let query = supabase
      .from("job_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (id) {
      query = supabase.from("job_runs").select("*").eq("id", id).single();
      const { data, error } = await query;

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json((data && data[0]) || null);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
