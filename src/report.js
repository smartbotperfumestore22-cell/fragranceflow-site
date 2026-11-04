// Monthly report: /dashboard/report.html?t=<store token>&m=YYYY-MM
// Same numbers as the dashboard (action=stats with month=), laid out as one printable page; "تحميل PDF" opens the print dialog.
import { fetchStats, linkToken, portalMode } from "./stats-api.js";
import { renderReport, monthName, defaultMonth } from "./report-view.js";

const qs = new URLSearchParams(location.search);
const token = linkToken;
const root = document.getElementById("dash");
const select = document.getElementById("r-month");
async function load(month) {
  root.setAttribute("aria-busy", "true");
  try {
    const data = await fetchStats({ month });
    if (data.error === "net") { root.innerHTML = '<p class="d-msg">تعذّر تحميل التقرير الآن. أعد المحاولة بعد قليل.</p>'; return; }
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">سجّل الدخول إلى فضاء التاجر لرؤية التقرير. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error === "invalid") { root.innerHTML = portalMode ? '<p class="d-msg">تعذّر العثور على متجرك. سجّل الخروج ثم ادخل من جديد، أو تواصل مع RihaFlow.</p>' : '<p class="d-msg">هذا الرابط لا يعمل أو تم تغييره. تواصل مع RihaFlow للحصول على رابط جديد.</p>'; return; }
    if (data.error) { root.innerHTML = '<p class="d-msg">لا توجد أرقام لهذا الشهر.</p>'; return; }
    select.innerHTML = data.months.map((m) => `<option value="${m}"${m === data.month ? " selected" : ""}>${monthName(m)}</option>`).join("");
    history.replaceState(null, "", `?${token ? "t=" + encodeURIComponent(token) + "&" : ""}m=${data.month}`);
    renderReport(root, data);
  } catch (e) {
    root.innerHTML = '<p class="d-msg">تعذّر تحميل التقرير الآن. أعد المحاولة بعد قليل.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

select.addEventListener("change", () => load(select.value));
document.getElementById("r-pdf").addEventListener("click", () => window.print());
load(/^\d{4}-\d{2}$/.test(qs.get("m") || "") ? qs.get("m") : defaultMonth());
