// Monthly report: /dashboard/report.html?t=<store token>&m=YYYY-MM
// Same numbers as the dashboard (action=stats with month=), laid out as one printable page; "تحميل PDF" opens the print dialog.
import "./dashboard.css";
import "./report.css";
import { fetchStats, linkToken, portalMode } from "./stats-api.js";
import { FAMILY, IMPRESSION, esc, fmt, pct, sorted, delta, dayLabel } from "./dash-common.js";

const qs = new URLSearchParams(location.search);
const token = linkToken;
const root = document.getElementById("dash");
const select = document.getElementById("r-month");
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "ماي", "يونيو", "يوليوز", "غشت", "شتنبر", "أكتوبر", "نونبر", "دجنبر"];
const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4);
const prevMonth = (m) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const dateAr = (d) => { const [y, m, dd] = d.split("-"); return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`; };
const ENOUGH = 20;   // below this many experiences we do not draw conclusions

function summary(d) {
  const t = d.totals || {}, exp = t.experiences || 0;
  if (exp < ENOUGH) return [];
  const out = [`${fmt(exp)} زبون جربو الكويز هاد الشهر، و${pct(t.completed || 0, exp)}% منهم كمّلوه حتى النتيجة.`];
  const fam = sorted(d.family)[0], famTotal = sorted(d.family).reduce((s, x) => s + x[1], 0);
  if (fam) out.push(`العائلة اللي كيقلبو عليها أكثر هي «${FAMILY[fam[0]] || fam[0]}» (${pct(fam[1], famTotal)}% من الاختيارات).`);
  const imp = sorted(d.impression)[0], impTotal = sorted(d.impression).reduce((s, x) => s + x[1], 0);
  if (imp) out.push(`والانطباع اللي باغيين يخليو هو «${IMPRESSION[imp[0]] || imp[0]}» (${pct(imp[1], impTotal)}%).`);
  return out;
}

// ideas built only from this month's numbers; nothing is said when the numbers are too few
function ideas(d) {
  const t = d.totals || {};
  if ((t.experiences || 0) < ENOUGH) return [];
  const out = [];
  const byWa = [...(d.perfumes || [])].sort((a, b) => b.whatsapp - a.whatsapp)[0];
  if (byWa && byWa.whatsapp >= 3) out.push(`${byWa.name} هو العطر اللي طلبو عليه أكثر فالواتساب (${fmt(byWa.whatsapp)} مرة). خليه ديما متوفر وبيّنو فالواجهة.`);
  const fam = sorted(d.family), famTotal = fam.reduce((s, x) => s + x[1], 0);
  if (fam[0] && pct(fam[0][1], famTotal) >= 30) out.push(`${pct(fam[0][1], famTotal)}% من زبنائك كيميلو لـ«${FAMILY[fam[0][0]] || fam[0][0]}». تأكد أن عندك اختيار مزيان من هاد العائلة.`);
  if (t.near && t.completed && t.near / t.completed >= 0.1) out.push(`${fmt(t.near)} مرة ما لقاش الزبون عطر كيجمع كلشي اللي بغا. زيادة عطور جديدة فالكاتالوگ غادي تعطيه نتائج أدق.`);
  return out;
}

const ICON = {
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 19v-1a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6"/>',
  check: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
  wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20z"/><path d="M9.5 9.5c.3 2 2 3.7 4 4l1-1 1.8.8-.4 1.4c-3.3.2-6.4-2.9-6.2-6.2l1.4-.4.8 1.8-1 1z"/>',
  pct: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

// three daily series with a light grid; oldest day on the left
function chart(days, series) {
  const W = 600, H = 230, L = 34, R = 10, T = 12, B = 26, n = days.length;
  const max = Math.max(4, ...series.flatMap((s) => s.v));
  const step = Math.ceil(max / 4), top = step * 4;
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const path = (v) => v.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p).toFixed(1)).join(" ");
  const grid = [0, 1, 2, 3, 4].map((k) => `<line x1="${L}" x2="${W - R}" y1="${y(k * step)}" y2="${y(k * step)}" stroke="#EEE8FB"/><text x="${L - 8}" y="${y(k * step) + 4}" text-anchor="end">${k * step}</text>`).join("");
  const ticks = [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
  const first = series[0].v;
  const area = path(first) + ` L${x(n - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="التجارب والمكملة والواتساب يوم بيوم" dir="ltr">${grid}
    <path d="${area}" fill="url(#rg)"/><defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9B8FA" stop-opacity=".45"/><stop offset="1" stop-color="#C9B8FA" stop-opacity="0"/></linearGradient></defs>
    ${series.map((s) => `<path d="${path(s.v)}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
    ${ticks.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${dayLabel(days[i])}</text>`).join("")}</svg>`;
}

function render(d) {
  const t = d.totals || {}, pv = d.prev, exp = t.experiences || 0, done = t.completed || 0, wa = t.whatsapp || 0, waV = t.whatsapp_visits || 0;
  const rate = pct(done, exp), prevRate = pv && pv.experiences ? pct(pv.completed || 0, pv.experiences) : null;
  const name = monthName(d.month);
  document.title = `${d.store.name} | تقرير ${name}`;
  const initials = d.store.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const kpi = (ic, label, val, before, shown, shownBefore) => `<div class="r-kpi"><span class="r-ic">${icon(ic)}</span><small>${label}</small>
      <b>${shown}</b>${before != null ? delta(val, before) + `<span class="r-was">الشهر اللي قبل: ${shownBefore}</span>` : ""}</div>`;
  const sum = summary(d), tips = ideas(d), perf = (d.perfumes || []).slice(0, 5), topShown = Math.max(1, ...perf.map((p) => p.shown));
  const fam = sorted(d.family).slice(0, 6), famT = sorted(d.family).reduce((a, x) => a + x[1], 0) || 1, famTop = fam.length ? fam[0][1] : 1;
  const imp = sorted(d.impression).slice(0, 5), impT = sorted(d.impression).reduce((a, x) => a + x[1], 0) || 1;
  const notes = [];
  if (d.partial && d.to === new Date().toISOString().slice(0, 10)) notes.push("الشهر مازال ما سالاش.");
  if (d.from > d.month + "-01") notes.push(`الأرقام كتبدا من ${dateAr(d.from)}.`);
  const funnel = [["بداو التجربة", exp, 100], ["كمّلو الكويز", done, rate], ["كليكاو على الواتساب", waV, pct(waV, done)]];
  const empty = '<p class="d-empty">مازال ما كاين حتى معلومة.</p>';
  root.innerHTML = `
  <article class="r-sheet">
    <header class="r-hero">
      <div class="r-title"><img class="r-logo" src="/images/brand/logo-lockup.webp" alt="FragranceFlow" width="720" height="161">
        <h1>التقرير الشهري</h1><p>أداء متجرك مع FragranceFlow</p></div>
      <div class="r-visual" aria-hidden="true"><img src="/images/hero-bottles.webp" alt=""></div>
      <div class="r-meta">
        <div class="r-chip"><span class="d-seal" style="${d.store.color ? "background:" + esc(d.store.color) : ""}">${d.store.logo ? `<img src="${esc(d.store.logo)}" alt="">` : esc(initials)}</span>
          <div><b>${esc(d.store.name)}</b><small>متجر عطور</small></div></div>
        <div class="r-chip"><span class="r-ic">${icon("cal")}</span><div><b>${esc(name)}</b><small>من ${dateAr(d.from)} حتى ${dateAr(d.to)}</small></div></div>
      </div>
    </header>
    ${notes.length ? `<p class="r-note">${notes.map(esc).join(" ")}</p>` : ""}
    <section class="r-kpis">
      ${kpi("users", "التجارب", exp, pv && pv.experiences, fmt(exp), fmt(pv && pv.experiences))}
      ${kpi("check", "كمّلو الكويز", done, pv && pv.completed, fmt(done), fmt(pv && pv.completed))}
      ${kpi("wa", "نقرات الواتساب", wa, pv && pv.whatsapp, fmt(wa), fmt(pv && pv.whatsapp))}
      ${kpi("pct", "نسبة الإكمال", rate, prevRate, rate + "%", prevRate + "%")}
    </section>
    <section class="r-row r-row-a">
      <div class="r-box"><h2>الأداء خلال الشهر</h2>
        <p class="r-legend"><span><i style="background:#C9B8FA"></i>التجارب</span><span><i style="background:#8B5CF6"></i>كمّلو الكويز</span><span><i style="background:#4C1D95"></i>واتساب</span></p>
        ${chart(d.days, [{ v: d.series.experiences, c: "#B59CF8" }, { v: d.series.completed, c: "#8B5CF6" }, { v: d.series.whatsapp, c: "#4C1D95" }])}</div>
      <div class="r-box"><h2>رحلة الزبون</h2>
        <ol class="r-funnel">${funnel.map(([l, v, p], i) => `<li style="--w:${100 - i * 12}%"><div><b>${fmt(v)}</b><small>${l}</small></div><em>${p}%</em></li>`).join("")}</ol>
        ${t.shares ? `<p class="r-small">${fmt(t.shares)} مرة تبارطاجات البصمة العطرية.</p>` : ""}</div>
    </section>
    <section class="r-row r-row-b">
      <div class="r-box"><h2>أكثر العطور ظهوراً فالنتائج</h2>
        ${perf.length ? `<ol class="r-perf">${perf.map((p, i) => `<li><span class="r-rank">${String(i + 1).padStart(2, "0")}</span>
          ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<span class="r-bottle" aria-hidden="true"></span>'}
          <div><b dir="ltr">${esc(p.brand ? p.brand + " " : "")}${esc(p.name)}</b><span class="d-bar"><i style="width:${Math.max(4, (p.shown / topShown) * 100)}%"></i></span></div>
          <small>${fmt(p.shown)} مرة</small></li>`).join("")}</ol>` : empty}</div>
      <div class="r-box"><h2>العائلات الأكثر طلباً</h2>
        ${fam.length ? `<ul class="r-fam">${fam.map(([k, v]) => `<li><span>${esc(FAMILY[k] || k)}</span><span class="d-bar"><i style="width:${Math.max(4, (v / famTop) * 100)}%"></i></span><b>${pct(v, famT)}%</b></li>`).join("")}</ul>` : empty}</div>
      <div class="r-box"><h2>الانطباعات الأكثر تكراراً</h2>
        ${imp.length ? `<ul class="r-imp">${imp.map(([k, v]) => `<li><span>${esc(IMPRESSION[k] || k)}</span><b>${pct(v, impT)}%</b></li>`).join("")}</ul>` : empty}</div>
    </section>
    <section class="r-row r-row-c">
      <div class="r-box r-insight"><h2><span class="r-ic">${icon("spark")}</span>خلاصة الشهر</h2>
        <p>${sum.length ? esc(sum.slice(1).join(" ") || sum[0]) : `الأرقام ديال هاد الشهر مازال قليلة (أقل من ${ENOUGH} تجربة) باش نخرجو منها خلاصات.`}</p></div>
      <div class="r-box r-tip"><h2><span class="r-ic">${icon("bulb")}</span>فكرة لهاد الشهر</h2>
        ${tips.length ? `<ul>${tips.slice(0, 2).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>غادي تبان هنا فكرة عملية ملي تكون الأرقام كافية.</p>"}</div>
    </section>
    <footer class="r-foot">
      <div><img src="/images/brand/logo-lockup.webp" alt="FragranceFlow" width="720" height="161"><small>من الذوق للطلب</small></div>
      <ul><li>${icon("cal")}تقرير ${esc(name)}</li><li>${esc(d.store.name)}</li><li dir="ltr">${esc(location.host.includes("vercel.app") ? "FragranceFlow" : location.host)}</li></ul>
    </footer>
  </article>`;
}

async function load(month) {
  root.setAttribute("aria-busy", "true");
  try {
    const data = await fetchStats({ month });
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">دخل لفضاء التاجر باش تشوف التقرير. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error === "invalid") { root.innerHTML = portalMode ? '<p class="d-msg">ما قدرناش نلقاو المتجر ديالك. خرج ودخل من جديد، ولا تواصل مع FragranceFlow.</p>' : '<p class="d-msg">هاد الرابط ما خدامش ولا تبدّل. تواصل مع FragranceFlow باش ياخد رابط جديد.</p>'; return; }
    if (data.error) { root.innerHTML = '<p class="d-msg">ما كاين حتى رقم فهاد الشهر.</p>'; return; }
    select.innerHTML = data.months.map((m) => `<option value="${m}"${m === data.month ? " selected" : ""}>${monthName(m)}</option>`).join("");
    history.replaceState(null, "", `?${token ? "t=" + encodeURIComponent(token) + "&" : ""}m=${data.month}`);
    render(data);
  } catch (e) {
    root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو التقرير دابا. عاود جرب من بعد شوية.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

// default: the last finished month, or this month if none has finished yet
function defaultMonth() {
  const now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prev = prevMonth(cur);
  return prev >= "2026-10" ? prev : cur;
}
select.addEventListener("change", () => load(select.value));
document.getElementById("r-pdf").addEventListener("click", () => window.print());
load(/^\d{4}-\d{2}$/.test(qs.get("m") || "") ? qs.get("m") : defaultMonth());
