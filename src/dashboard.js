// Store dashboard: /dashboard/?t=<secret token>. The token is the only thing sent; Apps Script finds the store
// from it and returns aggregated numbers only (see storeStats_ in apps-script/fragranceflow.gs).
import "./dashboard.css";
import { FF_SCRIPT_URL } from "./ff-script-url.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
const token = new URLSearchParams(location.search).get("t") || "";
const root = document.getElementById("dash");

const FAMILY = { floral: "زهري", woody: "خشبي", fresh: "منعش وحمضي", aquatic: "أكواتيك وبحري", oriental: "شرقي وعميق",
  sweet: "حلو ودافئ", clean: "نظيف", musky: "مسكي وناعم", fruity: "فاكهي وحيوي", heavy: "عميق" };
const IMPRESSION = { firstlook: "يتفكروك من أول لقاء", attractive: "حضور جذاب", elegant: "أناقة هادئة", confident: "قوة وثقة",
  mysterious: "غموض يخلّي الفضول", longlast: "أثر يبقى", luxury: "فخامة وثراء", fresh_imp: "حضور خفيف ومريح" };
const SOURCE = { instagram: "Instagram", whatsapp: "WhatsApp", qr: "QR فالمحل", website: "الموقع ديالك", facebook: "Facebook",
  tiktok: "TikTok", direct: "مباشر (بلا مصدر)", other: "مصادر أخرى" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const sorted = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
const dayLabel = (d) => { const [, m, dd] = d.split("-"); return Number(dd) + "/" + Number(m); };

function bars(obj, labels, max = 6) {
  const list = sorted(obj).slice(0, max);
  if (!list.length) return '<p class="d-empty">مازال ما كاين حتى معلومة.</p>';
  const top = list[0][1] || 1, total = list.reduce((s, x) => s + x[1], 0);
  return '<ul class="d-bars">' + list.map(([k, v]) =>
    `<li><span class="d-bar-name">${esc(labels[k] || k)}</span><span class="d-bar"><i style="width:${Math.max(4, (v / top) * 100)}%"></i></span><b>${pct(v, total)}%</b></li>`
  ).join("") + "</ul>";
}

function line(days, a, b) {
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
function delta(now, before) {
  if (before == null || !before) return "";
  const p = Math.round(((now - before) / before) * 100);
  return `<em class="d-delta ${p >= 0 ? "is-up" : "is-down"}">${p >= 0 ? "↗" : "↘"} ${Math.abs(p)}%</em>`;
}

// one plain sentence from the numbers, only when there are enough of them to say something
function insight(d) {
  const t = d.totals || {};
  if ((t.experiences || 0) < 20) return "";
  const src = sorted(d.source).filter(([k]) => k !== "direct")[0];
  const fam = sorted(d.family)[0];
  const parts = [];
  if (src && src[1] / t.experiences >= 0.3) parts.push(`أغلب زبنائك كيجيو من ${SOURCE[src[0]] || src[0]}`);
  if (fam) parts.push(`العائلة اللي كيختارو أكثر هي «${FAMILY[fam[0]] || fam[0]}»`);
  const top = (d.perfumes || [])[0];
  if (top && top.shown >= 10) parts.push(`و${top.name} هو العطر اللي كيطلع أكثر فالنتائج`);
  return parts.length ? parts.join("، ") + "." : "";
}

const SOURCES_LINKS = [["instagram", "Instagram", "حطو فالبيو ولا فالستوري"], ["whatsapp", "WhatsApp", "صيفطو للزبناء فالواتساب"],
  ["website", "الموقع ديالك", "زر ولا رابط فالموقع"], ["qr", "QR فالمحل", "اطبعو وحطو فالكونطوار"]];
function linksBlock(store) {
  const base = location.origin + "/?store=" + encodeURIComponent(store.id);
  const row = (src, name, hint) => {
    const url = base + (src ? "&source=" + src : "");
    return `<li><div><b>${name}</b><small>${hint}</small><code dir="ltr">${esc(url)}</code></div><button type="button" class="d-copy" data-url="${esc(url)}">نسخ</button></li>`;
  };
  return `<section class="d-card d-links" aria-labelledby="d-links-title">
    <h2 id="d-links-title">روابط متجرك</h2>
    <p class="d-sub">استعمل الرابط ديال كل بلاصة، باش تعرف منين كيجيو زبنائك.</p>
    <ul>${SOURCES_LINKS.map(([s, n, h]) => row(s, n, h)).join("")}${row("", "الرابط العام", "بلا مصدر")}</ul>
    <div class="d-qr"><canvas id="d-qr" width="200" height="200" aria-label="QR Code ديال متجرك"></canvas>
      <div><b>QR Code ديال المحل</b><small>فيه الرابط مع source=qr، باش تتحسب الزيارات اللي جات من المحل.</small>
      <a class="d-btn" id="d-qr-dl" download="qr-${esc(store.id)}.png" href="#">تحميل الـ QR</a></div></div>
  </section>`;
}

function render(d) {
  const t = d.totals || {};
  const exp = t.experiences || 0, done = t.completed || 0, waV = t.whatsapp_visits || 0;
  document.title = d.store.name + " | الإحصائيات";
  const pv = d.prev;
  const kpis = [
    ["تجربة", fmt(exp), "زيارات حلّو الكويز", delta(exp, pv && pv.experiences)],
    ["كمّلو الكويز", fmt(done), pct(done, exp) + "% من التجارب", delta(done, pv && pv.completed)],
    ["نقرات الواتساب", fmt(t.whatsapp || 0), fmt(waV) + " زبون كليكا", delta(t.whatsapp || 0, pv && pv.whatsapp)],
    ["بصمات تبارطاجات", fmt(t.shares || 0), "فالشبكات ولا تنسخات", delta(t.shares || 0, pv && pv.shares)],
  ];
  const tip = insight(d);
  const initials = d.store.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const funnel = [["حلّو الكويز", exp], ["كمّلوه", done], ["كليكاو على الواتساب", waV]];
  const perf = d.perfumes || [];
  const topShown = Math.max(1, ...perf.map((p) => p.shown));
  root.innerHTML = `
    <section class="d-head">
      <span class="d-seal" style="${d.store.color ? "background:" + esc(d.store.color) : ""}">${d.store.logo ? `<img src="${esc(d.store.logo)}" alt="">` : esc(initials)}</span>
      <div><h1>${esc(d.store.name)}</h1>
      <p>من ${esc(d.from)} حتى ${esc(d.to)} · كيتحدث كل ليلة، والنهار ديال اليوم مباشر.${pv ? " النسب مقارنة مع الفترة اللي قبل." : ""}</p></div>
    </section>
    <section class="d-kpis">${kpis.map(([l, v, s, dl]) => `<div class="d-card"><small>${l}</small><b>${v}${dl}</b><span>${s}</span></div>`).join("")}</section>
    ${tip ? `<p class="d-insight"><span aria-hidden="true">✦</span>${esc(tip)}</p>` : ""}
    <section class="d-grid">
      <div class="d-card d-wide">
        <h2>التجارب يوم بيوم</h2>
        <p class="d-legend"><span><i class="is-a"></i>التجارب</span><span><i class="is-b"></i>المكملة</span></p>
        ${line(d.days, d.series.experiences, d.series.completed)}
      </div>
      <div class="d-card">
        <h2>من التجربة حتى الواتساب</h2>
        <ol class="d-funnel">${funnel.map(([l, v]) => `<li><span>${l}</span><span class="d-bar"><i style="width:${exp ? Math.max(3, (v / exp) * 100) : 0}%"></i></span><b>${fmt(v)}</b></li>`).join("")}</ol>
        ${t.near ? `<p class="d-note">${fmt(t.near)} مرة ما لقاش الزبون عطر كيجمع كلشي، واقترحنا عليه الأقرب.</p>` : ""}
      </div>
      <div class="d-card">
        <h2>منين كيجيو الزوار</h2>
        ${bars(d.source, SOURCE)}
        <p class="d-note">باش يتعرف المصدر، زيد <code dir="ltr">&amp;source=instagram</code> (ولا whatsapp، website) للرابط ديالك.</p>
      </div>
      <div class="d-card">
        <h2>العائلات اللي كيختارو زبنائك</h2>
        ${bars(d.family, FAMILY, 9)}
      </div>
      <div class="d-card">
        <h2>الانطباع اللي باغيين</h2>
        ${bars(d.impression, IMPRESSION, 8)}
      </div>
      <div class="d-card d-wide">
        <h2>العطور اللي كتطلع أكثر فالنتائج</h2>
        ${perf.length ? `<table class="d-table"><thead><tr><th>العطر</th><th>طلع فالنتائج</th><th>واتساب</th></tr></thead><tbody>
          ${perf.map((p) => `<tr><td><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)}</small></td>
            <td><span class="d-bar"><i style="width:${Math.max(3, (p.shown / topShown) * 100)}%"></i></span>${fmt(p.shown)}</td><td>${fmt(p.whatsapp)}</td></tr>`).join("")}
        </tbody></table>` : '<p class="d-empty">مازال ما كاين حتى معلومة.</p>'}
      </div>
    </section>
    ${linksBlock(d.store)}
    <p class="d-foot">كنحسبو غير الاختيارات والنقرات، بلا حتى معلومة شخصية على الزبناء.</p>`;
}

function wireLinks(store) {
  root.querySelectorAll(".d-copy").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "تنسخ ✓"; }
    catch (e) { b.textContent = "حدد ونسخ"; }
    setTimeout(() => { b.textContent = "نسخ"; }, 2500);
  }));
  const canvas = document.getElementById("d-qr");
  if (!canvas) return;
  import("qrcode").then((m) => {
    const QR = m.default || m;
    const url = location.origin + "/?store=" + encodeURIComponent(store.id) + "&source=qr";
    QR.toCanvas(canvas, url, { width: 400, margin: 2, color: { dark: "#1D1430", light: "#FFFFFF" } }, () => {
      const a = document.getElementById("d-qr-dl"); if (a) a.href = canvas.toDataURL("image/png");
    });
  });
}

async function load(days) {
  if (!token) { root.innerHTML = '<p class="d-msg">هاد الرابط ناقص. استعمل الرابط اللي وصلك من FragranceFlow.</p>'; return; }
  root.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(`${API}?action=stats&t=${encodeURIComponent(token)}&days=${days}`);
    const data = await res.json();
    if (data.error) { root.innerHTML = '<p class="d-msg">هاد الرابط ما خدامش ولا تبدّل. تواصل مع FragranceFlow باش ياخد رابط جديد.</p>'; return; }
    render(data);
    wireLinks(data.store);
  } catch (e) {
    root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو الإحصائيات دابا. عاود جرب من بعد شوية.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

document.querySelectorAll(".dh-range button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".dh-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  load(Number(b.dataset.days));
}));
load(30);
