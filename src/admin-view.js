// The RihaFlow team's overview (totals, alerts, stores), shared by /admin/ and the portal's team view.
import "./admin.css";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function delta(now, before) {
  if (before == null || !before) return "";
  const p = Math.round(((now - before) / before) * 100);
  return `<em class="d-delta ${p >= 0 ? "is-up" : "is-down"}">${p >= 0 ? "↗" : "↘"} ${Math.abs(p)}%</em>`;
}
function ago(day, today) {
  if (!day) return "لا يوجد";
  const n = Math.round((new Date(today + "T12:00:00Z") - new Date(day + "T12:00:00Z")) / 864e5);
  return n <= 0 ? "اليوم" : n === 1 ? "أمس" : `من ${n} أيام`;
}
const ALERT = { inactive: "💤", token: "🔑", catalog: "🧴", trial: "⏳", data: "⚠️" };
const RANGE = { 1: "اليوم", 7: "آخر 7 أيام", 30: "آخر 30 يوماً" };

export function adminHTML(d, storeCell, foot = "لوحة خاصة بك. لا ترسل هذا الرابط لأي أحد.", opts = {}) {
  const t = d.totals, pv = d.prev;
  return `
    <section class="d-head"><div><h1>${d.title ? esc(d.title) : "لوحة الـ admin"}</h1>
      <p>${RANGE[d.days] || ""} · من ${esc(d.from)} إلى ${esc(d.to)}${pv ? " · النسب مقارنة بالفترة السابقة" : ""}</p></div></section>
    <section class="d-kpis a-kpis">
      <div class="d-card"><small>التجارب</small><b>${fmt(t.experiences)}${delta(t.experiences, pv && pv.experiences)}</b><span>في جميع المتاجر</span></div>
      <div class="d-card"><small>أكملوا الكويز</small><b>${fmt(t.completed)}${delta(t.completed, pv && pv.completed)}</b><span>${pct(t.completed, t.experiences)}% معدل الإكمال</span></div>
      <div class="d-card"><small>نقرات الواتساب</small><b>${fmt(t.whatsapp)}${delta(t.whatsapp, pv && pv.whatsapp)}</b><span>${pct(t.whatsapp, t.completed)}% ممن أكملوا</span></div>
      <div class="d-card"><small>المتاجر النشيطة</small><b>${fmt(d.storesWithActivity)}<span class="a-of"> / ${fmt(d.storesActive)}</span></b><span>لديها تجارب في هذه الفترة</span></div>
    </section>
    ${d.site && d.site.experiences ? `<p class="a-site">الكويز العام (بدون متجر): ${fmt(d.site.experiences)} تجربة، ${fmt(d.site.completed)} مكتملة. غير محسوبة في المجموع.</p>` : ""}
    <section class="d-card a-alerts" aria-labelledby="a-alerts-title">
      <h2 id="a-alerts-title">التنبيهات ${d.alerts.length ? `<span class="a-count">${d.alerts.length}</span>` : ""}</h2>
      ${d.alerts.length ? `<ul>${d.alerts.map((a, i) => `<li class="is-${a.type}"><span aria-hidden="true">${ALERT[a.type] || "•"}</span><div>${a.store ? `<b>${esc(a.store)}</b> ` : ""}${esc(a.text)}</div>${opts.fix ? opts.fix(a, i) : ""}</li>`).join("")}</ul>`
        : '<p class="d-empty">كل شيء على ما يرام ✅</p>'}
    </section>
    ${opts.stores === false ? "" : storesHTML(d, storeCell)}
    <p class="d-foot">${esc(foot)}</p>`;
}


// the stores list (activity in the chosen period, status, and the button to manage each one)
export function storesHTML(d, storeCell) {
  return `
    <section class="d-card" aria-labelledby="a-stores-title">
      <div class="a-stores-head"><h2 id="a-stores-title">المتاجر <span class="a-count a-count-n" dir="ltr">${d.stores.length}</span></h2>
        <label class="a-search"><span class="sr">ابحث عن متجر</span><input type="search" placeholder="🔎 ابحث عن متجر (الاسم أو store_id)…" autocomplete="off" data-a-search></label></div>
      <div class="a-scroll"><table class="d-table a-table">
        <thead><tr><th>المتجر</th><th>التجارب</th><th>المكملة</th><th>واتساب</th><th>العطور</th><th>آخر نشاط</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${d.stores.map((s) => `<tr class="${s.active ? "" : "is-off"}" data-q="${esc((s.name + " " + s.id).toLowerCase())}">
          <td><b>${esc(s.name)}</b><small dir="ltr">${esc(s.id)}</small></td>
          <td data-l="التجارب">${fmt(s.experiences)}</td><td data-l="المكملة">${fmt(s.completed)} <small>${s.experiences ? pct(s.completed, s.experiences) + "%" : ""}</small></td>
          <td data-l="واتساب">${fmt(s.whatsapp)}</td><td data-l="العطور">${fmt(s.perfumes)}</td><td data-l="آخر نشاط">${ago(s.last, d.to)}</td>
          <td data-l="الحالة"><span class="a-status ${s.active ? "is-on" : ""}">${s.active ? "نشيط" : "موقوف"}</span></td>
          <td>${storeCell(s)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <p class="d-empty" data-a-none hidden>لا يوجد متجر بهذا الاسم.</p>
    </section>
`;
}

// the search box above the stores list: filters the rows as you type (name or store_id)
export function wireStoreSearch(root) {
  const input = root.querySelector("[data-a-search]");
  if (!input) return;
  const rows = [...root.querySelectorAll(".a-table tbody tr")], none = root.querySelector("[data-a-none]"), n = root.querySelector(".a-count-n");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((r) => { const ok = !q || r.dataset.q.includes(q); r.hidden = !ok; if (ok) shown++; });
    none.hidden = shown > 0;
    if (n) n.textContent = q ? `${shown} / ${rows.length}` : String(rows.length);
  });
}
