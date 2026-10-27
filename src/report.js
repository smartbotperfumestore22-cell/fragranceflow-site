// Monthly report: /dashboard/report.html?t=<store token>&m=YYYY-MM
// Same numbers as the dashboard (action=stats with month=), laid out as one printable page; "تحميل PDF" opens the print dialog.
import "./dashboard.css";
import "./report.css";
import { FF_SCRIPT_URL } from "./ff-script-url.js";
import { FAMILY, IMPRESSION, esc, fmt, pct, sorted, bars, line, delta } from "./dash-common.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
const qs = new URLSearchParams(location.search);
const token = qs.get("t") || "";
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

function render(d) {
  const t = d.totals || {}, pv = d.prev, exp = t.experiences || 0, done = t.completed || 0;
  const name = monthName(d.month);
  document.title = `${d.store.name} | تقرير ${name}`;
  const initials = d.store.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const kpis = [
    ["تجربة", exp, "زيارات حلّو الكويز", pv && pv.experiences],
    ["كمّلو الكويز", done, pct(done, exp) + "% من التجارب", pv && pv.completed],
    ["نقرات الواتساب", t.whatsapp || 0, fmt(t.whatsapp_visits || 0) + " زبون كليكا", pv && pv.whatsapp],
    ["بصمات تبارطاجات", t.shares || 0, "فالشبكات ولا تنسخات", pv && pv.shares],
  ];
  const sum = summary(d), tips = ideas(d), perf = (d.perfumes || []).slice(0, 5);
  const notes = [];
  if (d.partial && d.to === new Date().toISOString().slice(0, 10)) notes.push("الشهر مازال ما سالاش، والأرقام كتزاد كل نهار.");
  if (d.from > d.month + "-01") notes.push(`الأرقام كتبدا من ${dateAr(d.from)}، النهار اللي بدا فيه الحساب.`);
  root.innerHTML = `
    <article class="r-page">
      <header class="r-top">
        <span class="d-seal" style="${d.store.color ? "background:" + esc(d.store.color) : ""}">${d.store.logo ? `<img src="${esc(d.store.logo)}" alt="">` : esc(initials)}</span>
        <div><p class="r-kicker">التقرير الشهري · ${esc(d.store.name)}</p><h1>${esc(name)}</h1>
          <p class="r-period">من ${dateAr(d.from)} حتى ${dateAr(d.to)}${pv ? ` · النسب مقارنة مع ${esc(monthName(prevMonth(d.month)))}` : ""}</p></div>
      </header>
      ${notes.length ? `<p class="r-note">${notes.map(esc).join(" ")}</p>` : ""}
      <section class="d-kpis r-kpis">${kpis.map(([l, v, s, b]) => `<div class="d-card"><small>${l}</small><b>${fmt(v)}${delta(v, b)}</b><span>${s}</span></div>`).join("")}</section>
      <section class="r-block">
        <h2>ملخص الشهر</h2>
        ${sum.length ? `<p class="r-summary">${sum.map(esc).join(" ")}</p>` : `<p class="d-empty">الأرقام ديال هاد الشهر مازال قليلة (أقل من ${ENOUGH} تجربة) باش نخرجو منها خلاصات.</p>`}
      </section>
      ${d.days.length > 1 ? `<section class="r-block"><h2>التجارب يوم بيوم</h2>
        <p class="d-legend"><span><i class="is-a"></i>التجارب</span><span><i class="is-b"></i>المكملة</span></p>
        ${line(d.days, d.series.experiences, d.series.completed)}</section>` : ""}
      <section class="r-block">
        <h2>أكثر 5 عطور طلعو فالنتائج</h2>
        ${perf.length ? `<table class="d-table r-table"><thead><tr><th>العطر</th><th>طلع فالنتائج</th><th>واتساب</th></tr></thead><tbody>
          ${perf.map((p, i) => `<tr><td><span class="r-rank">${i + 1}</span><span><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)}</small></span></td><td>${fmt(p.shown)}</td><td>${fmt(p.whatsapp)}</td></tr>`).join("")}
        </tbody></table>` : '<p class="d-empty">مازال ما كاين حتى عطر.</p>'}
      </section>
      <section class="r-two">
        <div class="r-block"><h2>العائلات اللي كيختارو</h2>${bars(d.family, FAMILY, 5)}</div>
        <div class="r-block"><h2>الانطباع اللي باغيين</h2>${bars(d.impression, IMPRESSION, 5)}</div>
      </section>
      ${tips.length ? `<section class="r-block r-ideas"><h2>أفكار للشهر الجاي</h2><ul>${tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
      <footer class="r-foot">
        <img src="/images/brand/logo-lockup.webp" alt="FragranceFlow" width="720" height="161">
        <span>كنحسبو غير الاختيارات والنقرات، بلا حتى معلومة شخصية على الزبناء.</span>
      </footer>
    </article>`;
}

async function load(month) {
  if (!token) { root.innerHTML = '<p class="d-msg">هاد الرابط ناقص. حل التقرير من صفحة الإحصائيات ديالك.</p>'; return; }
  root.setAttribute("aria-busy", "true");
  try {
    const url = `${API}?action=stats&t=${encodeURIComponent(token)}&month=${encodeURIComponent(month)}`;
    let data = await (await fetch(url)).json();
    if (data.error === "invalid") { root.innerHTML = '<p class="d-msg">هاد الرابط ما خدامش ولا تبدّل. تواصل مع FragranceFlow باش ياخد رابط جديد.</p>'; return; }
    if (data.error) { root.innerHTML = '<p class="d-msg">ما كاين حتى رقم فهاد الشهر.</p>'; return; }
    select.innerHTML = data.months.map((m) => `<option value="${m}"${m === data.month ? " selected" : ""}>${monthName(m)}</option>`).join("");
    history.replaceState(null, "", `?t=${encodeURIComponent(token)}&m=${data.month}`);
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
