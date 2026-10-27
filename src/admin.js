// FragranceFlow admin: /admin/?t=<admin token> (the token is kept in Apps Script's Script Properties).
// Read only: totals across stores, the list of stores with their numbers and dashboard links, and alerts.
import "./dashboard.css";
import { adminHTML } from "./admin-view.js";
import { FF_SCRIPT_URL } from "./ff-script-url.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
const token = new URLSearchParams(location.search).get("t") || "";
const root = document.getElementById("dash");
function render(d) {
  root.innerHTML = adminHTML(d, (s) => !token ? `<a class="d-btn a-open" href="/dashboard/" data-store="${esc(s.id)}">Dashboard</a>`
    : s.dashboard ? `<a class="d-btn a-open" href="${esc(s.dashboard)}" target="_blank" rel="noopener">Dashboard</a>` : "<small>بلا رابط</small>");
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// two ways in: the secret admin link (?t=…), or a FragranceFlow team login on the portal (Supabase)
async function fetchAdmin(days) {
  if (token) return (await fetch(`${API}?action=admin&t=${encodeURIComponent(token)}&days=${days}`)).json();
  const { sb } = await import("./supabase.js");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "login" };
  return (await fetch(API, { method: "POST", body: JSON.stringify({ action: "admin", jwt: session.access_token, days }) })).json();
}

async function load(days) {
  root.setAttribute("aria-busy", "true");
  try {
    const data = await fetchAdmin(days);
    if (data.error === "login") { root.innerHTML = '<p class="d-msg">دخل لفضاء التاجر بالحساب ديالك. <a href="/portal/">دخول</a></p>'; return; }
    if (data.error) { root.innerHTML = token ? '<p class="d-msg">هاد الرابط ما خدامش. صاوب رابط جديد من الشيت: FragranceFlow ← 🔐 رابط لوحة الـ admin.</p>' : '<p class="d-msg">هاد الصفحة غير لفريق FragranceFlow. <a href="/portal/">رجوع لفضاء التاجر</a></p>'; return; }
    render(data);
    if (!token) {
      root.querySelector(".d-head").insertAdjacentHTML("beforeend", '<a class="d-btn a-portal" href="/portal/">فضاء التاجر ←</a>');
      root.querySelectorAll("[data-store]").forEach((a) => a.addEventListener("click", () => { try { sessionStorage.setItem("ff_store", a.dataset.store); } catch (e) {} }));
    }
  } catch (e) {
    root.innerHTML = '<p class="d-msg">ما قدرناش نجيبو الأرقام دابا. عاود جرب من بعد شوية.</p>';
  } finally { root.removeAttribute("aria-busy"); }
}
document.querySelectorAll(".dh-range button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".dh-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  load(Number(b.dataset.days));
}));
load(7);
