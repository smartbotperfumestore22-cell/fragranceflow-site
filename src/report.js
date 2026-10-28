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
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">دخل لفضاء التاجر باش تشوف التقرير. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error === "invalid") { root.innerHTML = portalMode ? '<p class="d-msg">ما قدرناش نلقاو المتجر ديالك. خرج ودخل من جديد، ولا تواصل مع FragranceFlow.</p>' : '<p class="d-msg">هاد الرابط ما خدامش ولا تبدّل. تواصل مع FragranceFlow باش ياخد رابط جديد.</p>'; return; }
    if (data.error) { root.innerHTML = '<p class="d-msg">ما كاين حتى رقم فهاد الشهر.</p>'; return; }
    select.innerHTML = data.months.map((m) => `<option value="${m}"${m === data.month ? " selected" : ""}>${monthName(m)}</option>`).join("");
    history.replaceState(null, "", `?${token ? "t=" + encodeURIComponent(token) + "&" : ""}m=${data.month}`);
    renderReport(root, data);
  } catch (e) {
    root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو التقرير دابا. عاود جرب من بعد شوية.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

select.addEventListener("change", () => load(select.value));
document.getElementById("r-pdf").addEventListener("click", () => window.print());
load(/^\d{4}-\d{2}$/.test(qs.get("m") || "") ? qs.get("m") : defaultMonth());
