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
    if (data.error === "net") { root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو الإحصائيات دابا. عاود جرب من بعد شوية.</p>'; return; }
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">دخل لفضاء التاجر باش تشوف الإحصائيات. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error) { root.innerHTML = portalMode ? '<p class="d-msg">ما قدرناش نلقاو المتجر ديالك. خرج ودخل من جديد، ولا تواصل مع FragranceFlow.</p>' : '<p class="d-msg">هاد الرابط ما خدامش ولا تبدّل. تواصل مع FragranceFlow باش ياخد رابط جديد.</p>'; return; }
    renderDashboard(root, data, { token, portalMode });
  } catch (e) {
    root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو الإحصائيات دابا. عاود جرب من بعد شوية.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}

document.querySelectorAll(".dh-range button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".dh-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  load(Number(b.dataset.days));
}));
load(30);
