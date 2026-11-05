// The RihaFlow team's platform numbers (admin_insights, 013): all stores together, aggregates only.
// Shown in the portal's team overview, under the alerts.
import { FAMILY, IMPRESSION, SOURCE, esc, fmt, pct, bars, line, genderSplit } from "./dash-common.js";

const PRICE = 299; // monthly subscription in MAD, as on the stores homepage
const dateAr = (d) => { const [, m, dd] = d.split("-"); return `${Number(dd)}/${Number(m)}`; };

export function insightsHTML(d, { revenue = true } = {}) {
  const t = d.totals || {}, s = d.subscriptions || {}, c = d.catalog || {}, perf = d.perfumes || [];
  const topShown = Math.max(1, ...perf.map((p) => p.shown));
  const health = [
    ["بدون صورة", c.noImage, "عطور نشيطة بدون رابط صورة"],
    ["بدون نوتات", c.noNotes, "لا يظهر فيها «تخيّل الرائحة»"],
    ["بدون تركيز", c.noConcentration, "عدد الرشات يُحسب كأنه EDP"],
    ["غير موجودة عند أي متجر", c.neverOffered, "في الكتالوگ ولا يبيعها أحد"],
    ["متاجر بدون عطور", c.storesEmpty, "لا يظهر لها شيء في الكويز"],
    ["طلبات كتسنا", c.requests, "📝 الطلبات"],
  ];
  return `
    <section class="d-kpis a-kpis a-kpis-sm">
      <div class="d-card"><small>مشاركات البصمة</small><b>${fmt(t.shares)}</b><span>عبر الواتساب، Instagram…</span></div>
      <div class="d-card"><small>لم يجدوا كل ما يريدون</small><b>${fmt(t.near)}</b><span>${pct(t.near || 0, t.completed || 0)}% ممن أكملوا · اقترحنا الأقرب</span></div>
      <div class="d-card"><small>العطور في الكتالوگ</small><b>${fmt(c.perfumes)}</b><span>نشيطين</span></div>
      <div class="d-card"><small>العروض المتوفرة</small><b>${fmt(c.offers)}</b><span>عطر × متجر، متوفرة الآن</span></div>
    </section>
    <section class="d-grid a-ins">
      <div class="d-card d-wide">
        <h2>النشاط يوم بيوم <small class="a-h-sub">جميع المتاجر</small></h2>
        <p class="d-legend"><span><i></i>التجارب</span><span><i class="is-b"></i>المكملة</span></p>
        ${(d.dates || []).length > 1 ? line(d.dates, d.series.experiences, d.series.completed) : `<p class="d-empty">اختر «7 أيام» أو «30 يوماً» لإظهار المنحنى.</p>`}
      </div>
      <div class="d-card">
        <h2>العطر لمن؟</h2>
        ${genderSplit(d.gender)}
      </div>
      <div class="d-card">
        <h2>من أين يأتي الزوار</h2>
        ${bars(d.source, SOURCE, 6)}
      </div>
      <div class="d-card">
        <h2>العائلات المطلوبة</h2>
        ${bars(d.family, FAMILY, 9)}
      </div>
      <div class="d-card">
        <h2>الانطباع المطلوب</h2>
        ${bars(d.impression, IMPRESSION, 8)}
      </div>
      <div class="d-card d-wide">
        <h2>العطور الأكثر ظهوراً في جميع المتاجر</h2>
        ${perf.length ? `<div class="a-scroll"><table class="d-table"><thead><tr><th>العطر</th><th>ظهر في النتائج</th><th>واتساب</th><th>عند</th></tr></thead><tbody>
          ${perf.map((p) => `<tr><td><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)}</small></td>
            <td><span class="d-bar"><i style="width:${Math.max(3, (p.shown / topShown) * 100)}%"></i></span>${fmt(p.shown)}</td>
            <td>${fmt(p.whatsapp)}</td><td>${fmt(p.stores)} ${p.stores === 1 ? "متجر" : "متاجر"}</td></tr>`).join("")}
        </tbody></table></div>` : '<p class="d-empty">لا توجد معلومات بعد.</p>'}
      </div>
      <div class="d-card">
        <h2>الاشتراكات</h2>
        <ul class="a-subs">
          <li><b>${fmt(s.active)}</b><span>مفعّل</span></li>
          <li><b>${fmt(s.trial)}</b><span>في التجربة</span></li>
          <li class="${s.expired ? "is-warn" : ""}"><b>${fmt(s.expired)}</b><span>انتهت التجربة</span></li>
          <li><b>${fmt(s.paused)}</b><span>موقوف</span></li>
        </ul>
        ${revenue ? `<p class="a-mrr">مدخول شهري تقديري: <b>${fmt((s.active || 0) * PRICE)} درهم</b> <small>(${fmt(s.active)} × ${PRICE} درهم، المفعّلون فقط)</small></p>` : ""}
        ${(s.ending || []).length ? `<h3 class="a-h3">تنتهي التجربة هذا الأسبوع</h3><ul class="a-ending">${s.ending.map((e) => `<li><b>${esc(e.store)}</b><span>${dateAr(e.date)}</span></li>`).join("")}</ul>` : ""}
      </div>
      <div class="d-card">
        <h2>حالة الكتالوگ</h2>
        <ul class="a-health">${health.map(([l, v, hint]) => `<li class="${v ? "is-warn" : "is-ok"}"><span>${v ? "⚠️" : "✅"}</span><div><b>${l}</b><small>${hint}</small></div><em>${fmt(v)}</em></li>`).join("")}</ul>
      </div>
    </section>`;
}
