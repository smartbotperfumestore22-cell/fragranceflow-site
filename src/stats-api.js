// Numbers for the store dashboard and the monthly report.
// They come from Supabase (store_stats / store_stats_by_token). Phase 3: the Google Sheet no longer receives events,
// so its numbers are not used any more; an error is shown instead of old numbers.
// Two ways in: the secret link (?t=…), or a merchant signed in to the portal (Supabase login).
import { SUPABASE_URL, SUPABASE_KEY } from "./supabase-config.js";

export const linkToken = new URLSearchParams(location.search).get("t") || "";
export const portalMode = !linkToken;

const ok = (d) => d && typeof d === "object" && !d.error && d.store && Array.isArray(d.days);

export async function fetchStats(params) {
  const days = params.days != null ? Number(params.days) : null, month = params.month || null;
  if (linkToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/store_stats_by_token`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_token: linkToken, p_days: days, p_month: month }) });
      if (res.ok) { const d = await res.json(); return ok(d) ? d : (d && d.error ? d : { error: "net" }); }
      return { error: "net" };
    } catch (e) { return { error: "net" }; }
  }
  const { sb } = await import("./supabase.js");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "login" };
  let store = "";
  try { store = sessionStorage.getItem("ff_store") || ""; } catch (e) { /* private mode */ }
  try {
    const { data, error } = await sb.rpc("store_stats", { p_store: store || null, p_days: days, p_month: month });
    if (error) return { error: "net" };
    return ok(data) ? data : (data && data.error ? data : { error: "net" });
  } catch (e) { return { error: "net" }; }
}
