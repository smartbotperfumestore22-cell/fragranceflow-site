// Event tracking for the site pages (homepage, catalogue, fragrance pages), available before the quiz loads.
// Same request as the quiz's own window.track (src/widget/App.jsx), which replaces this one once the quiz is loaded.
// Sends only the event name, an anonymous per-tab visit id, the visit source (utm) and the details passed in.
export function siteTrack(event, data) {
  try {
    const base = (window.__FF_CONFIG__ || {}).ANALYTICS_URL;
    if (!base) return;
    const extra = {};
    try {
      let v = sessionStorage.getItem("ff_sid");
      if (!v) { v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("ff_sid", v); }
      extra.visit = v; // never "sid": Apps Script reserves it and answers 400
      const utm = sessionStorage.getItem("ff_utm"); if (utm) extra.utm = utm;
    } catch (e) {}
    const params = new URLSearchParams({ action: "analytics", store: (window.__FF_CONFIG__ || {}).STORE_NAME || "", key: "", event, ...extra, ...(data || {}) });
    fetch(`${base}?${params.toString()}`, { mode: "no-cors" }).catch(() => {}); // blocked or offline: ignore
  } catch (e) {}
}
if (!window.track) window.track = siteTrack;
