// Store dashboard: /dashboard/?t=<secret token>. The token is the only thing sent; Apps Script finds the store
// from it and returns aggregated numbers only (see storeStats_ in apps-script/fragranceflow.gs).
import "./dashboard.css";
import { fetchStats, linkToken, portalMode } from "./stats-api.js";
import { renderDashboard } from "./dashboard-view.js";

const token = linkToken;
const root = document.getElementById("dash");

async function load(days) {
  root.setAttribute("aria-busy", "true");
  try {
    const data = await fetchStats({ days });
    if (data.error === "net") { root.innerHTML = '<p class="d-msg">تعذّر تحميل الإحصائيات الآن. أعد المحاولة بعد قليل.</p>'; return; }
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">سجّل الدخول إلى فضاء التاجر لرؤية الإحصائيات. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error) { root.innerHTML = portalMode ? '<p class="d-msg">تعذّر العثور على متجرك. سجّل الخروج ثم ادخل من جديد، أو تواصل مع RihaFlow.</p>' : '<p class="d-msg">هذا الرابط لا يعمل أو تم تغييره. تواصل مع RihaFlow للحصول على رابط جديد.</p>'; return; }
    renderDashboard(root, data, { token, portalMode });
  } catch (e) {
    root.innerHTML = '<p class="d-msg">تعذّر تحميل الإحصائيات الآن. أعد المحاولة بعد قليل.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

document.querySelectorAll(".dh-range button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".dh-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  load(Number(b.dataset.days));
}));
load(30);
