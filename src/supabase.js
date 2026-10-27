// Supabase client for the merchant portal. The publishable key is public by design:
// what each person can read or change is decided by the row-level security rules in supabase/001_schema.sql.
import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL, SUPABASE_KEY } from "./supabase-config.js";
export { SUPABASE_URL, SUPABASE_KEY };
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
