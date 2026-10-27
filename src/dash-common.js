// shared by the store dashboard and the monthly report
export const FAMILY = { floral: "زهري", woody: "خشبي", fresh: "منعش وحمضي", aquatic: "أكواتيك وبحري", oriental: "شرقي وعميق",
  sweet: "حلو ودافئ", clean: "نظيف", musky: "مسكي وناعم", fruity: "فاكهي وحيوي", heavy: "عميق" };
export const IMPRESSION = { firstlook: "يتفكروك من أول لقاء", attractive: "حضور جذاب", elegant: "أناقة هادئة", confident: "قوة وثقة",
  mysterious: "غموض يخلّي الفضول", longlast: "أثر يبقى", luxury: "فخامة وثراء", fresh_imp: "حضور خفيف ومريح" };
export const SOURCE = { instagram: "Instagram", whatsapp: "WhatsApp", qr: "QR فالمحل", website: "الموقع ديالك", facebook: "Facebook",
  tiktok: "TikTok", direct: "مباشر (بلا مصدر)", other: "مصادر أخرى" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString("en-US");
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const sorted = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
export const dayLabel = (d) => { const [, m, dd] = d.split("-"); return Number(dd) + "/" + Number(m); };

export function bars(obj, labels, max = 6) {
  const list = sorted(obj).slice(0, max);
  if (!list.length) return '<p class="d-empty">مازال ما كاين حتى معلومة.</p>';
  const top = list[0][1] || 1, total = list.reduce((s, x) => s + x[1], 0);
  return '<ul class="d-bars">' + list.map(([k, v]) =>
    `<li><span class="d-bar-name">${esc(labels[k] || k)}</span><span class="d-bar"><i style="width:${Math.max(4, (v / top) * 100)}%"></i></span><b>${pct(v, total)}%</b></li>`
  ).join("") + "</ul>";
}

export function line(days, a, b) {
  // two series (experiences, completed) as a small SVG chart, oldest on the left
  const W = 640, H = 180, P = 24, n = days.length, max = Math.max(1, ...a, ...b);
  const x = (i) => (n === 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = (s) => s.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const area = path(a) + ` L${x(n - 1).toFixed(1)} ${H - P} L${x(0).toFixed(1)} ${H - P} Z`;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, arr) => arr.indexOf(v) === i);
  return `<svg class="d-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="التجارب والتجارب المكملة يوم بيوم" dir="ltr">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#E5DCFB"/>
    <path d="${area}" fill="rgba(91,53,200,.10)"/>
    <path d="${path(a)}" fill="none" stroke="#5B35C8" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${path(b)}" fill="none" stroke="#B9A3F7" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>
    ${ticks.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#5F5873">${dayLabel(days[i])}</text>`).join("")}
    <text x="${P}" y="14" font-size="11" fill="#5F5873">${fmt(max)}</text>
  </svg>`;
}

// "↗ 12%" against the period just before (nothing when there is no earlier period to compare with)
export function delta(now, before) {
  if (before == null || !before) return "";
  const p = Math.round(((now - before) / before) * 100);
  return `<em class="d-delta ${p >= 0 ? "is-up" : "is-down"}">${p >= 0 ? "↗" : "↘"} ${Math.abs(p)}%</em>`;
}

