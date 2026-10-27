// Numbers for the store dashboard and the monthly report, from Apps Script.
// Two ways in: the secret link (?t=…) as before, or a merchant signed in to the portal (Supabase login),
// in which case the login token is sent and Apps Script checks which store it belongs to.
import { FF_SCRIPT_URL } from "./ff-script-url.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
export const linkToken = new URLSearchParams(location.search).get("t") || "";
export const portalMode = !linkToken;

export async function fetchStats(params) {
  if (linkToken) {
    const q = new URLSearchParams({ action: "stats", t: linkToken, ...params });
    return (await fetch(`${API}?${q}`)).json();
  }
  const { sb } = await import("./supabase.js");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "login" };
  let store = "";
  try { store = sessionStorage.getItem("ff_store") || ""; } catch (e) { /* private mode */ }
  // text/plain keeps it a "simple" request (no CORS preflight, which Apps Script does not answer)
  const res = await fetch(API, { method: "POST", body: JSON.stringify({ action: "stats", jwt: session.access_token, store, ...params }) });
  return res.json();
}
