// Phase 2: every visit event is also recorded in Supabase (record_event checks it the same way as the Apps Script).
// Sent next to the Sheet while the two are compared; failures are ignored, like the Sheet request.
import { SUPABASE_URL, SUPABASE_KEY } from "./supabase-config.js";

export function sbTrack(params) {
  try {
    if (!params || !params.event) return;
    const p = {};
    Object.keys(params).forEach((k) => { if (params[k] != null && params[k] !== "") p[k] = String(params[k]); });
    fetch(`${SUPABASE_URL}/rest/v1/rpc/record_event`, {
      method: "POST", keepalive: true,
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p }),
    }).catch(() => {});
  } catch (e) {}
}
