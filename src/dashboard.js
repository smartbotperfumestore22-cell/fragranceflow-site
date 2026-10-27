// Store dashboard: /dashboard/?t=<secret token>. The token is the only thing sent; Apps Script finds the store
// from it and returns aggregated numbers only (see storeStats_ in apps-script/fragranceflow.gs).
import "./dashboard.css";
import { FF_SCRIPT_URL } from "./ff-script-url.js";
import { FAMILY, IMPRESSION, SOURCE, esc, fmt, pct, sorted, bars, line, delta } from "./dash-common.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
const token = new URLSearchParams(location.search).get("t") || "";
const root = document.getElementById("dash");

// one plain sentence from the numbers, only when there are enough of them to say something
function insight(d) {
  const t = d.totals || {};
  if ((t.experiences || 0) < 20) return "";
  const src = sorted(d.source).filter(([k]) => k !== "direct")[0];
  const fam = sorted(d.family)[0];
  const parts = [];
  if (SHOW_SOURCES && src && src[1] / t.experiences >= 0.3) parts.push(`أغلب زبنائك كيجيو من ${SOURCE[src[0]] || src[0]}`);
  if (fam) parts.push(`العائلة اللي كيختارو أكثر هي «${FAMILY[fam[0]] || fam[0]}»`);
  const top = (d.perfumes || [])[0];
  if (top && top.shown >= 10) parts.push(`و${top.name} هو العطر اللي كيطلع أكثر فالنتائج`);
  return parts.length ? parts.join("، ") + "." : "";
}

// visit sources (card + links per source): planned for a later update, hidden for now
const SHOW_SOURCES = false;
// links per source (instagram, whatsapp, …)
const SOURCES_LINKS = [["instagram", "Instagram", "حطو فالبيو ولا فالستوري"], ["whatsapp", "WhatsApp", "صيفطو للزبناء فالواتساب"],
  ["website", "الموقع ديالك", "زر ولا رابط فالموقع"], ["qr", "QR فالمحل", "اطبعو وحطو فالكونطوار"]];
function linksBlock(store) {
  const base = location.origin + "/?store=" + encodeURIComponent(store.id);
  const row = (src, name, hint) => {
    const url = base + (src ? "&source=" + src : "");
    return `<li><div><b>${name}</b><small>${hint}</small><code dir="ltr">${esc(url)}</code></div><button type="button" class="d-copy" data-url="${esc(url)}">نسخ</button></li>`;
  };
  return `<section class="d-card d-links" aria-labelledby="d-links-title">
    <h2 id="d-links-title">الرابط ديال متجرك</h2>
    <p class="d-sub">حطو فالبيو، صيفطو فالواتساب، ولا زيدو فالموقع ديالك.</p>
    <ul>${row("", "الرابط ديال الكويز", "نفس الرابط لكل البلايص")}</ul>
    <div class="d-qr"><canvas id="d-qr" width="200" height="200" aria-label="QR Code ديال متجرك"></canvas>
      <div><b>QR Code ديال المحل</b><small>اطبعو وحطو فالكونطوار ولا على الرفوف.</small>
      <a class="d-btn" id="d-qr-dl" download="qr-${esc(store.id)}.png" href="#">تحميل الـ QR Code</a></div></div>
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
      <a class="d-btn d-report" href="/dashboard/report.html?t=${encodeURIComponent(token)}">التقرير الشهري</a>
    </section>
    <section class="d-kpis">${kpis.map(([l, v, s, dl]) => `<div class="d-card"><small>${l}</small><b>${v}${dl}</b><span>${s}</span></div>`).join("")}</section>
    ${tip ? `<p class="d-insight"><span aria-hidden="true">✦</span>${esc(tip)}</p>` : ""}
    <section class="d-grid">
      <div class="d-card d-wide">
        <h2>التجارب يوم بيوم</h2>
        <p class="d-legend"><span><i class="is-a"></i>التجارب</span><span><i class="is-b"></i>المكملة</span></p>
        ${line(d.days, d.series.experiences, d.series.completed)}
      </div>
      <div class="d-card${SHOW_SOURCES ? "" : " d-wide"}">
        <h2>من التجربة حتى الواتساب</h2>
        <ol class="d-funnel">${funnel.map(([l, v]) => `<li><span>${l}</span><span class="d-bar"><i style="width:${exp ? Math.max(3, (v / exp) * 100) : 0}%"></i></span><b>${fmt(v)}</b></li>`).join("")}</ol>
        ${t.near ? `<p class="d-note">${fmt(t.near)} مرة ما لقاش الزبون عطر كيجمع كلشي، واقترحنا عليه الأقرب.</p>` : ""}
      </div>
      ${SHOW_SOURCES ? `      <div class="d-card">
        <h2>منين كيجيو الزوار</h2>
        ${bars(d.source, SOURCE)}
      </div>` : ""}
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
