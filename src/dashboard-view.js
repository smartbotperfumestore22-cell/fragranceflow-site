// The store dashboard as a view: used by /dashboard/ (secret link or portal login) and inside the portal («📊 الإحصائيات»).
import "./dashboard.css";
import { FAMILY, IMPRESSION, SOURCE, esc, fmt, pct, sorted, bars, line, delta, genderSplit } from "./dash-common.js";

// one plain sentence from the numbers, only when there are enough of them to say something
function insight(d) {
  const t = d.totals || {};
  if ((t.experiences || 0) < 20) return "";
  const src = sorted(d.source).filter(([k]) => k !== "direct")[0];
  const fam = sorted(d.family)[0];
  const parts = [];
  if (SHOW_SOURCES && src && src[1] / t.experiences >= 0.3) parts.push(`أغلب زبنائك يأتون من ${SOURCE[src[0]] || src[0]}`);
  if (fam) parts.push(`العائلة الأكثر اختياراً هي «${FAMILY[fam[0]] || fam[0]}»`);
  const top = (d.perfumes || [])[0];
  if (top && top.shown >= 10) parts.push(`و${top.name} هو العطر الأكثر ظهوراً في النتائج`);
  return parts.length ? parts.join("، ") + "." : "";
}

// visit sources (card + links per source): planned for a later update, hidden for now
const SHOW_SOURCES = false;
// links per source (instagram, whatsapp, …)
const SOURCES_LINKS = [["instagram", "Instagram", "ضعه في البيو أو في الستوري"], ["whatsapp", "WhatsApp", "أرسله للزبناء عبر الواتساب"],
  ["website", "موقعك", "زر أو رابط في الموقع"], ["qr", "QR في المحل", "اطبعه وضعه على الكونطوار"]];
function linksBlock(store) {
  const base = location.origin + "/?store=" + encodeURIComponent(store.id);
  const row = (src, name, hint) => {
    const url = base + (src ? "&source=" + src : "");
    return `<li><div><b>${name}</b><small>${hint}</small><code dir="ltr">${esc(url)}</code></div><button type="button" class="d-copy" data-url="${esc(url)}">نسخ</button></li>`;
  };
  return `<section class="d-card d-links" aria-labelledby="d-links-title">
    <h2 id="d-links-title">رابط متجرك</h2>
    <p class="d-sub">ضعه في البيو، أو أرسله عبر الواتساب، أو أضفه إلى موقعك.</p>
    <ul>${row("", "رابط الكويز", "نفس الرابط لكل الأماكن")}</ul>
    <div class="d-qr"><canvas id="d-qr" width="200" height="200" aria-label="QR Code الخاص بمتجرك"></canvas>
      <div><b>QR Code الخاص بالمحل</b><small>اطبعه وضعه على الكونطوار أو على الرفوف.</small>
      <a class="d-btn" id="d-qr-dl" download="qr-${esc(store.id)}.png" href="#">تحميل الـ QR Code</a></div></div>
  </section>`;
}

export function renderDashboard(root, d, opts = {}) {
  const inPortal = !!opts.inPortal;
  const t = d.totals || {};
  const exp = t.experiences || 0, done = t.completed || 0, waV = t.whatsapp_visits || 0;
  if (!inPortal) document.title = d.store.name + " | الإحصائيات";
  const pv = d.prev;
  const kpis = [
    ["تجربة", fmt(exp), "زيارات فتحت الكويز", delta(exp, pv && pv.experiences)],
    ["أكملوا الكويز", fmt(done), pct(done, exp) + "% من التجارب", delta(done, pv && pv.completed)],
    ["نقرات الواتساب", fmt(t.whatsapp || 0), fmt(waV) + " زبون ضغط", delta(t.whatsapp || 0, pv && pv.whatsapp)],
    ["بصمات تمت مشاركتها", fmt(t.shares || 0), "في الشبكات أو تم نسخها", delta(t.shares || 0, pv && pv.shares)],
  ];
  const tip = insight(d);
  const initials = d.store.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const funnel = [["فتحوا الكويز", exp], ["أكملوه", done], ["ضغطوا على الواتساب", waV]];
  const perf = d.perfumes || [];
  const topShown = Math.max(1, ...perf.map((p) => p.shown));
  root.innerHTML = `
    <section class="d-head">
      <span class="d-seal" style="${d.store.color ? "background:" + esc(d.store.color) : ""}">${d.store.logo ? `<img src="${esc(d.store.logo)}" alt="">` : esc(initials)}</span>
      <div><h1>${esc(d.store.name)}</h1>
      <p>من ${esc(d.from)} إلى ${esc(d.to)} · يتحدّث كل ليلة، وأرقام اليوم مباشرة.${pv ? " النسب مقارنة بالفترة السابقة." : ""}</p></div>
      ${inPortal ? "" : `<a class="d-btn d-report" href="/dashboard/report.html${opts.token ? "?t=" + encodeURIComponent(opts.token) : ""}">التقرير الشهري</a>${opts.portalMode ? '<a class="p-back" href="/portal/">العودة إلى فضاء التاجر</a>' : ""}`}
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
        <h2>من التجربة إلى الواتساب</h2>
        <ol class="d-funnel">${funnel.map(([l, v]) => `<li><span>${l}</span><span class="d-bar"><i style="width:${exp ? Math.max(3, (v / exp) * 100) : 0}%"></i></span><b>${fmt(v)}</b></li>`).join("")}</ol>
        ${t.near ? `<p class="d-note">${fmt(t.near)} مرة لم يجد الزبون عطراً يجمع كل ما طلبه، فاقترحنا عليه الأقرب.</p>` : ""}
      </div>
      ${SHOW_SOURCES ? `      <div class="d-card">
        <h2>من أين يأتي الزوار</h2>
        ${bars(d.source, SOURCE)}
      </div>` : ""}
      <div class="d-card d-wide">
        <h2>العطر لمن؟</h2>
        <p class="d-sub">الجواب عن أول سؤال في الكويز، من الزبناء الذين أكملوه.</p>
        ${genderSplit(d.gender)}
      </div>
      <div class="d-card">
        <h2>العائلات التي يختارها زبناؤك</h2>
        ${bars(d.family, FAMILY, 9)}
      </div>
      <div class="d-card">
        <h2>الانطباع المطلوب</h2>
        ${bars(d.impression, IMPRESSION, 8)}
      </div>
      <div class="d-card d-wide">
        <h2>العطور الأكثر ظهوراً في النتائج</h2>
        ${perf.length ? `<table class="d-table"><thead><tr><th>العطر</th><th>ظهر في النتائج</th><th>واتساب</th></tr></thead><tbody>
          ${perf.map((p) => `<tr><td><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)}</small></td>
            <td><span class="d-bar"><i style="width:${Math.max(3, (p.shown / topShown) * 100)}%"></i></span>${fmt(p.shown)}</td><td>${fmt(p.whatsapp)}</td></tr>`).join("")}
        </tbody></table>` : '<p class="d-empty">لا توجد معلومات بعد.</p>'}
      </div>
    </section>
    ${inPortal ? "" : linksBlock(d.store)}
    <p class="d-foot">نحسب الاختيارات والنقرات فقط، دون أي معلومة شخصية عن الزبناء.</p>`;
  if (!inPortal) wireLinks(root, d.store);
}

function wireLinks(root, store) {
  root.querySelectorAll(".d-copy").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "تم النسخ ✓"; }
    catch (e) { b.textContent = "حدّد وانسخ"; }
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

