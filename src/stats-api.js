// Numbers for the store dashboard and the monthly report.
// Phase 2: they come from Supabase (store_stats / store_stats_by_token); if Supabase cannot answer,
// the Apps Script (Google Sheet) answers as before, so the pages keep working during the move.
// Two ways in: the secret link (?t=…), or a merchant signed in to the portal (Supabase login).
import { FF_SCRIPT_URL } from "./ff-script-url.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./supabase-config.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
export const linkToken = new URLSearchParams(location.search).get("t") || "";
export const portalMode = !linkToken;

const ok = (d) => d && typeof d === "object" && !d.error;

async function fromSheetByLink(params) {
  const q = new URLSearchParams({ action: "stats", t: linkToken, ...params });
  return (await fetch(`${API}?${q}`)).json();
}

export async function fetchStats(params) {
  const days = params.days != null ? Number(params.days) : null, month = params.month || null;
  if (linkToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/store_stats_by_token`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_token: linkToken, p_days: days, p_month: month }) });
      if (res.ok) { const d = await res.json(); if (ok(d) || (d && d.error === "month")) return d; }
    } catch (e) { /* fall back to the Sheet */ }
    return fromSheetByLink(params);
  }
  const { sb } = await import("./supabase.js");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "login" };
  let store = "";
  try { store = sessionStorage.getItem("ff_store") || ""; } catch (e) { /* private mode */ }
  try {
    const { data, error } = await sb.rpc("store_stats", { p_store: store || null, p_days: days, p_month: month });
    if (!error && (ok(data) || (data && data.error === "month"))) return data;
  } catch (e) { /* fall back to the Sheet */ }
  // text/plain keeps it a "simple" request (no CORS preflight, which Apps Script does not answer)
  const res = await fetch(API, { method: "POST", body: JSON.stringify({ action: "stats", jwt: session.access_token, store, ...params }) });
  return res.json();
}
