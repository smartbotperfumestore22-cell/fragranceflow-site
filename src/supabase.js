// Supabase client for the merchant portal. The publishable key is public by design:
// what each person can read or change is decided by the row-level security rules in supabase/001_schema.sql.
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://vnfuoqiqzzxbogppxxxl.supabase.co";
export const SUPABASE_KEY = "sb_publishable_l6FVDheuxVbDSl-5644xGg_RheEQcyJ";
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
