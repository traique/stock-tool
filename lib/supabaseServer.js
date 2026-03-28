// lib/supabaseServer.js
import { createClient } from "@supabase/supabase-js";

export function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL");
  }

  const supabaseKey = serviceRoleKey || anonKey;

  if (!supabaseKey) {
    throw new Error("Thiếu SUPABASE_SERVICE_ROLE_KEY hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
