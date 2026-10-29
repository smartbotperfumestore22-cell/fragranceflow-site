// Merchant portal: /portal/ — sign in (accounts are created by FragranceFlow, no public sign-up),
// then the merchant manages its own offers (price, stock, remove/restore, add from the catalogue) and sends requests
// for perfumes that are not in the catalogue yet. Every rule is enforced again by Supabase row-level security.
import "./dashboard.css";
import "./portal.css";
import { sb } from "./supabase.js";
import { esc, fmt } from "./dash-common.js";
import { adminHTML, wireStoreSearch } from "./admin-view.js";
import { renderDashboard } from "./dashboard-view.js";
import { renderReport, monthName, defaultMonth } from "./report-view.js";
import { fetchStats } from "./stats-api.js";
import { FF_SCRIPT_URL } from "./ff-script-url.js";

const API = import.meta.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL;
// team-only actions run in Apps Script (it holds the Supabase secret key); the login token proves who is asking
async function teamCall(action, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(API, { method: "POST", body: JSON.stringify({ action, jwt: session && session.access_token, ...body }) });
  return res.json();
}

const app = document.getElementById("app");
const userBox = document.getElementById("p-user");
const S = { user: null, admin: false, mode: "store", teamTab: "overview", days: 7, stores: [], store: null, tab: "offers", offers: [], catalog: null, requests: [], q: "", flash: "" };
const GENDER = { men: "رجالي", women: "نسائي", unisex: "للجميع" };
const STATUS = { pending: "كيتسنى", approved: "تقبل", rejected: "ما تقبلش" };
const daysLeft = (d) => Math.ceil((new Date(d) - Date.now()) / 864e5);
const dateAr = (d) => new Date(d).toLocaleDateString("ar-MA", { day: "numeric", month: "long", year: "numeric" });

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "p-toast" + (bad ? " is-bad" : ""); t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}
const errText = (e) => {
  const m = String((e && (e.message || e.error_description)) || e || "");
  if (/Invalid login credentials/i.test(m)) return "الإيميل ولا كلمة السر غالطين.";
  if (/Email not confirmed/i.test(m)) return "الحساب مازال ما تفعّلش. تواصل مع FragranceFlow.";
  if (/rate limit|too many/i.test(m)) return "حاولتي بزاف ديال المرات. عاود من بعد شوية.";
  if (/Password should be at least/i.test(m)) return "كلمة السر خاصها تكون 8 حروف ولا أكثر.";
  if (/network|fetch/i.test(m)) return "ما كاينش الاتصال. تأكد من الأنترنت وعاود.";
  return "وقع مشكل. عاود جرب.";
};

// ───────────── sign in / password ─────────────
function viewLogin(msg) {
  userBox.hidden = true;
  app.innerHTML = `<section class="p-auth d-card">
    <h1>فضاء التاجر</h1><p class="p-sub">دخل باش تبدل الأثمنة، التوفر، وتطلب عطور جديدة.</p>
    ${msg ? `<p class="p-alert">${esc(msg)}</p>` : ""}
    <form id="f-login" novalidate>
      <label>الإيميل<input type="email" name="email" autocomplete="username" required dir="ltr"></label>
      <label>كلمة السر<input type="password" name="password" autocomplete="current-password" required dir="ltr"></label>
      <button class="d-btn p-wide" type="submit">دخول</button>
    </form>
    <button class="p-link" type="button" id="b-forgot">نسيتي كلمة السر؟</button>
    <p class="p-small">ما عندكش حساب؟ الحسابات كيصاوبهم FragranceFlow. تواصل معانا فالواتساب.</p>
  </section>`;
  const f = document.getElementById("f-login");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = f.querySelector("button"); b.disabled = true; b.textContent = "كندخلو…";
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { b.disabled = false; b.textContent = "دخول"; viewLogin(errText(error)); }
  });
  document.getElementById("b-forgot").addEventListener("click", viewForgot);
}

function viewForgot() {
  app.innerHTML = `<section class="p-auth d-card"><h1>نسيتي كلمة السر؟</h1>
    <p class="p-sub">كتب الإيميل ديالك، ونصيفطو ليك رابط باش تختار كلمة سر جديدة.</p>
    <form id="f-forgot"><label>الإيميل<input type="email" name="email" autocomplete="username" required dir="ltr"></label>
    <button class="d-btn p-wide" type="submit">صيفط الرابط</button></form>
    <button class="p-link" type="button" id="b-back">رجوع للدخول</button></section>`;
  document.getElementById("b-back").addEventListener("click", () => viewLogin());
  const f = document.getElementById("f-forgot");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + "/portal/" });
    if (error) return toast(errText(error), true);
    app.querySelector(".p-auth").innerHTML = `<h1>شوف الإيميل ديالك 📩</h1><p class="p-sub">إلا كان هاد الإيميل عندو حساب، غادي يوصلك رابط فدقايق. شوف حتى فالـ Spam.</p>
      <button class="p-link" type="button" onclick="location.reload()">رجوع للدخول</button>`;
  });
}

function viewNewPassword() {
  app.innerHTML = `<section class="p-auth d-card"><h1>كلمة سر جديدة</h1>
    <form id="f-new"><label>كلمة السر الجديدة (8 حروف ولا أكثر)<input type="password" name="p" minlength="8" autocomplete="new-password" required dir="ltr"></label>
    <button class="d-btn p-wide" type="submit">حفظ</button></form></section>`;
  const f = document.getElementById("f-new");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: f.p.value });
    if (error) return toast(errText(error), true);
    toast("تبدلات كلمة السر ✓"); start();
  });
}

// ───────────── loading ─────────────
let starting = false;
async function start() {
  if (starting) return; starting = true;
  try { await start_(); } finally { starting = false; }
}
async function start_() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return viewLogin();
  S.user = session.user;
  userBox.hidden = false;
  userBox.innerHTML = `<span dir="ltr">${esc(S.user.email)}</span><button type="button" class="p-link" id="b-out">خروج</button>`;
  document.getElementById("b-out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  const [mem, adm] = await Promise.all([
    sb.from("store_members").select("store_id, stores(*)"),
    sb.from("admins").select("user_id").maybeSingle(),
  ]);
  if (mem.error) { app.innerHTML = `<p class="d-msg">${errText(mem.error)}</p>`; return; }
  S.admin = !!(adm.data);
  S.stores = (mem.data || []).map((m) => m.stores).filter(Boolean);
  if (S.admin) {
    const all = await sb.from("stores").select("*").order("name");
    if (!all.error) S.stores = all.data;
  }
  if (S.admin) {
    // the team starts on its own overview; a store is opened from there (and the choice is kept while the tab is open)
    const saved = sessionStorage.getItem("ff_store");
    S.store = S.stores.find((x) => x.id === saved) || null;
    S.mode = sessionStorage.getItem("ff_mode") === "store" && S.store ? "store" : "team";
    if (S.mode === "team") return renderTeam();
    return loadStore();
  }
  if (!S.stores.length) { app.innerHTML = '<section class="d-card p-auth"><h1>ما لقينا حتى متجر مربوط بهاد الحساب</h1><p class="p-sub">تواصل مع FragranceFlow باش يربطو الحساب ديالك بالمتجر.</p></section>'; return; }
  const saved = sessionStorage.getItem("ff_store");
  S.store = S.stores.find((s) => s.id === saved) || S.stores[0];
  await loadStore();
}

async function loadStore() {
  sessionStorage.setItem("ff_store", S.store.id);
  const [o, r] = await Promise.all([
    sb.from("offers").select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, variants, perfumes(name, brand, gender, image_url, size)").eq("store_id", S.store.id),
    sb.from("requests").select("*").eq("store_id", S.store.id).order("created_at", { ascending: false }),
  ]);
  if (o.error) { toast(errText(o.error), true); }
  S.offers = (o.data || []).sort((a, b) => (a.perfumes?.brand || "").localeCompare(b.perfumes?.brand || "") || (a.perfumes?.name || "").localeCompare(b.perfumes?.name || ""));
  S.requests = r.data || [];
  render();
}

async function loadCatalog() {
  if (S.catalog) return S.catalog;
  const { data, error } = await sb.from("perfumes").select("perfume_id, name, brand, gender, size, ref_price, image_url").eq("active", true).order("brand").order("name");
  if (error) { toast(errText(error), true); return []; }
  return (S.catalog = data);
}

// ───────────── page ─────────────
function trialBanner(s) {
  if (s.subscription_status === "active") return "";
  if (s.subscription_status === "trial" && s.trial_ends_at) {
    const n = daysLeft(s.trial_ends_at);
    if (n > 0) return `<p class="p-banner">الفترة التجريبية: باقي ليك <b>${n} ${n === 1 ? "نهار" : "أيام"}</b> (حتى ${dateAr(s.trial_ends_at)}). العطور ديالك كيبانو للزبناء.</p>`;
    return `<p class="p-banner is-bad">سالات الفترة التجريبية نهار ${dateAr(s.trial_ends_at)}. العطور ديالك ما بقاوش كيبانو للزبناء. تواصل مع FragranceFlow باش تفعّل الاشتراك.</p>`;
  }
  if (s.subscription_status === "paused" || s.subscription_status === "cancelled") return '<p class="p-banner is-bad">الاشتراك موقوف، والعطور ديالك ما كيبانوش للزبناء. تواصل مع FragranceFlow.</p>';
  return "";
}

function render() {
  if (S.mode === "team") return renderTeam();
  const s = S.store, live = S.offers.filter((o) => o.active), off = live.filter((o) => !o.in_stock).length;
  const pending = S.requests.filter((r) => r.status === "pending").length;
  const tabs = [["offers", `عطوري <small>${live.length}</small>`], ["add", "زيد عطر"], ["requests", `طلب عطر جديد${pending ? ` <small>${pending}</small>` : ""}`],
    ["stats", "📊 الإحصائيات"], ["report", "📄 التقرير الشهري"], ["settings", "⚙️ إعدادات المتجر"]];
  if (!tabs.some(([k]) => k === S.tab)) S.tab = "offers";
  app.innerHTML = `
    ${S.admin ? '<div class="p-backbar"><button type="button" class="p-link" id="b-team">← رجوع للوحة العامة</button><span>كتشوف المتجر بحال التاجر</span></div>' : ""}
    <section class="d-head p-head">
      <span class="d-seal" style="${s.color ? "background:" + esc(s.color) : ""}">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : esc(s.name.slice(0, 2).toUpperCase())}</span>
      <div><h1>${esc(s.name)}</h1><p>${fmt(live.length)} عطر · ${fmt(off)} مقطوع</p></div>
      ${!S.admin && S.stores.length > 1 ? `<label class="p-pick">المتجر<select id="s-store">${S.stores.map((x) => `<option value="${esc(x.id)}"${x.id === s.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    </section>
    ${trialBanner(s)}
    ${linkCard(s)}
    <nav class="p-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</nav>
    <section id="tab" class="${S.tab === "stats" || S.tab === "report" ? "p-wide-tab" : "d-card p-panel"}"></section>
    <p class="d-foot">التبديلات كتبان للزبناء فالكويز فـ 10 حتى 15 دقيقة.</p>`;
  app.querySelectorAll(".p-tabs button").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; S.q = ""; render(); }));
  const pick = document.getElementById("s-store");
  if (pick) pick.addEventListener("change", () => { S.store = S.stores.find((x) => x.id === pick.value); loadStore(); });
  wireLinkCard(s);
  const back = document.getElementById("b-team");
  if (back) back.addEventListener("click", () => { S.mode = "team"; sessionStorage.setItem("ff_mode", "team"); renderTeam(); });
  ({ offers: tabOffers, add: tabAdd, requests: tabRequests, settings: tabSettings, stats: tabStats, report: tabReport }[S.tab] || tabOffers)();
}

// statistics and monthly report, inside the store space (same numbers as /dashboard/, read with the login)
const statsError = (d) => d.error === "login" ? "خرج ودخل من جديد." : d.error === "month" ? "ما كاين حتى رقم فهاد الشهر." : "ما قدرناش نجيبو الأرقام دابا. عاود جرب من بعد شوية.";
async function tabStats() {
  const el = document.getElementById("tab");
  const range = `<div class="dh-range p-range" role="group" aria-label="المدة">${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" aria-pressed="${(S.statDays || 30) === d}">${d === 7 ? "7 أيام" : d + " يوم"}</button>`).join("")}</div>`;
  el.innerHTML = range + '<div id="p-stats" aria-live="polite"><p class="d-msg">كنجيبو الإحصائيات…</p></div>';
  el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.statDays = Number(b.dataset.days); tabStats(); }));
  const box = document.getElementById("p-stats");
  let d; try { d = await fetchStats({ days: S.statDays || 30 }); } catch (e) { d = { error: "net" }; }
  if (S.tab !== "stats" || !document.getElementById("p-stats")) return;   // the merchant moved to another tab meanwhile
  if (d.error) { box.innerHTML = `<p class="d-msg">${statsError(d)}</p>`; return; }
  renderDashboard(box, d, { inPortal: true });
}
async function tabReport(month) {
  const el = document.getElementById("tab");
  const m = month || S.reportMonth || defaultMonth();
  el.innerHTML = `<div class="r-tools p-rtools"><label class="r-month"><span class="sr">الشهر</span><select id="p-month" aria-label="الشهر"><option>${esc(monthName(m))}</option></select></label>
      <button type="button" class="d-btn" id="p-pdf">تحميل PDF</button></div>
    <div id="p-report" aria-live="polite"><p class="d-msg">كنوجدو التقرير…</p></div>`;
  const box = document.getElementById("p-report");
  let d; try { d = await fetchStats({ month: m }); } catch (e) { d = { error: "net" }; }
  if (S.tab !== "report" || !document.getElementById("p-report")) return;
  if (d.error) { box.innerHTML = `<p class="d-msg">${statsError(d)}</p>`; return; }
  S.reportMonth = d.month;
  const sel = document.getElementById("p-month");
  sel.innerHTML = d.months.map((x) => `<option value="${x}"${x === d.month ? " selected" : ""}>${esc(monthName(x))}</option>`).join("");
  sel.addEventListener("change", () => tabReport(sel.value));
  renderReport(box, d, { inPortal: true });
  // print only the report sheet (one A4 page), not the portal around it
  document.getElementById("p-pdf").addEventListener("click", () => {
    document.body.classList.add("p-print-report");
    const done = () => { document.body.classList.remove("p-print-report"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    setTimeout(done, 60000);
  });
}

// the store's quiz link and QR code, always at the top of the store space (the merchant shares them)
const storeLink = (s) => location.origin + "/?store=" + encodeURIComponent(s.id);
function linkCard(s) {
  const url = storeLink(s);
  return `<section class="d-card p-linkcard" aria-labelledby="p-link-title">
    <div class="p-link-main">
      <h2 id="p-link-title">🔗 الرابط ديال متجرك</h2>
      <p class="p-small">حطو فالبيو ديال Instagram، صيفطو للزبناء فالواتساب، ولا زيدو فالموقع ديالك.</p>
      <div class="p-linkrow"><input readonly dir="ltr" value="${esc(url)}" aria-label="الرابط ديال متجرك" id="p-store-url">
        <button type="button" class="d-btn" id="b-copy-link">نسخ</button></div>
      <div class="p-review p-linkacts">
        <a class="p-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("دوز اختبار العطور ديالنا ولقا العطر اللي كيناسبك: " + url)}">صيفطو فالواتساب</a>
        <a class="p-link" target="_blank" rel="noopener" href="${esc(url)}#quiz">جرّب الكويز</a>
      </div>
    </div>
    <div class="p-qr"><canvas id="p-qr" width="132" height="132" aria-label="QR Code ديال متجرك"></canvas>
      <a class="p-link" id="b-qr-dl" download="qr-${esc(s.id)}.png" href="#">تحميل الـ QR</a>
      <small>اطبعو وحطو فالمحل</small></div>
  </section>`;
}
function wireLinkCard(s) {
  const b = document.getElementById("b-copy-link"), inp = document.getElementById("p-store-url");
  if (b) b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(inp.value); b.textContent = "تنسخ ✓"; }
    catch (e) { inp.select(); b.textContent = "حدد ونسخ"; }
    setTimeout(() => { b.textContent = "نسخ"; }, 2500);
  });
  if (inp) inp.addEventListener("focus", () => inp.select());
  const canvas = document.getElementById("p-qr");
  if (!canvas) return;
  import("qrcode").then((m) => {
    const QR = m.default || m;
    // the printed QR carries source=qr, so visits from the shop counter are counted apart
    const qrUrl = storeLink(s) + "&source=qr";
    QR.toCanvas(canvas, qrUrl, { width: 132, margin: 1, color: { dark: "#1D1430", light: "#FFFFFF" } }, () => {});
    // the download is a bigger image, sharp when printed
    const big = document.createElement("canvas");
    QR.toCanvas(big, qrUrl, { width: 800, margin: 2, color: { dark: "#1D1430", light: "#FFFFFF" } }, () => {
      const a = document.getElementById("b-qr-dl"); if (a) a.href = big.toDataURL("image/png");
    });
  }).catch(() => { canvas.replaceWith(Object.assign(document.createElement("small"), { textContent: "ما قدرناش نوجدو الـ QR دابا." })); });
}

// the FragranceFlow team's own space: overview of every store, accounts, requests
function openStore(id) {
  S.store = S.stores.find((x) => x.id === id); if (!S.store) return;
  S.mode = "store"; S.tab = "offers"; sessionStorage.setItem("ff_mode", "store");
  loadStore();
}
function renderTeam() {
  const tabs = [["overview", "🌐 اللوحة العامة"], ["perfumes", "🧴 العطور"], ["accounts", "👥 الحسابات"], ["review", "📝 الطلبات"]];
  app.innerHTML = `
    <section class="d-head p-head"><div><h1>لوحة FragranceFlow</h1><p>${fmt(S.stores.length)} متجر · غير لفريق FragranceFlow</p></div>
      <button type="button" class="d-btn p-publish" id="b-publish">🚀 نشر الموقع دابا</button></section>
    <nav class="p-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-team="${k}" aria-selected="${S.teamTab === k}">${l}</button>`).join("")}</nav>
    <section id="tab" class="${S.teamTab === "overview" ? "p-overview" : "d-card p-panel"}"></section>`;
  app.querySelectorAll("[data-team]").forEach((b) => b.addEventListener("click", () => { S.teamTab = b.dataset.team; renderTeam(); }));
  document.getElementById("b-publish").addEventListener("click", async (e) => {
    e.target.disabled = true;
    let r; try { r = await teamCall("publish", { now: true }); } catch (er) { r = { error: "net" }; }
    e.target.disabled = false;
    if (r.published) toast("🚀 تصيفط. الكويز كيتحدث ف دقيقة ولا جوج.");
    else if (r.queued) toast("تسجل الطلب: كاين نشر ديجا قبل شوية، غادي يتعاود ف 10 دقايق.");
    else toast("ما تنشرش. تأكد من Apps Script (New version) ورابط النشر.", true);
  });
  ({ overview: tabOverview, perfumes: tabPerfumes, accounts: tabAccounts, review: tabReview }[S.teamTab] || tabOverview)();
}
async function tabOverview() {
  const el = document.getElementById("tab");
  const range = `<div class="p-range dh-range" role="group" aria-label="المدة">${[[1, "اليوم"], [7, "7 أيام"], [30, "30 يوم"]].map(([d, l]) => `<button type="button" data-days="${d}" aria-pressed="${S.days === d}">${l}</button>`).join("")}</div>`;
  el.innerHTML = range + '<p class="d-msg">كنجيبو الأرقام…</p>';
  const wire = () => el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.days = Number(b.dataset.days); tabOverview(); }));
  wire();
  // from Supabase (the Sheet's numbers are not used any more)
  let d = null;
  try { const r = await sb.rpc("admin_stats", { p_days: S.days }); if (!r.error && r.data && Array.isArray(r.data.stores)) d = r.data; } catch (e) {}
  if (!d) d = { error: "net" };
  if (d.error) { el.innerHTML = range + '<p class="d-msg">ما قدرناش نجيبو الأرقام من Supabase دابا. عاود جرب من بعد شوية.</p>'; wire(); return; }
  // stores that exist in Supabase but have no numbers yet still appear, so every store can be opened from here
  const known = new Set(d.stores.map((x) => x.id));
  S.stores.forEach((x) => { if (!known.has(x.id)) d.stores.push({ id: x.id, name: x.name, active: x.active !== false, perfumes: 0, experiences: 0, completed: 0, whatsapp: 0, last: "" }); });
  el.innerHTML = range + adminHTML({ ...d, title: "اللوحة العامة" }, (x) => S.stores.some((y) => y.id === x.id)
    ? `<button type="button" class="d-btn a-open" data-manage="${esc(x.id)}">إدارة المتجر</button>` : "<small>ما كاينش ف Supabase</small>", "الأرقام والمتاجر والحسابات من Supabase.");
  wire(); wireStoreSearch(el);
  el.querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openStore(b.dataset.manage)));
}

const search = (ph) => `<div class="p-search"><input type="search" id="q" placeholder="${ph}" value="${esc(S.q)}" autocomplete="off"></div>`;
const match = (p, q) => !q || (p.name + " " + p.brand).toLowerCase().includes(q.toLowerCase());
function wireSearch(redraw) {
  const q = document.getElementById("q");
  q.addEventListener("input", () => { S.q = q.value; redraw(); });
}
const thumb = (p) => (p && p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : '<span class="p-bottle" aria-hidden="true"></span>');

// my offers
function tabOffers() {
  const el = document.getElementById("tab");
  el.innerHTML = `${search("قلب على عطر فالعطور ديالك…")}<ul class="p-list" id="list"></ul>`;
  const draw = () => {
    const list = S.offers.filter((o) => match(o.perfumes || { name: o.perfume_id, brand: "" }, S.q));
    const ul = document.getElementById("list");
    if (!S.offers.length) { ul.innerHTML = '<li class="d-empty">مازال ما عندك حتى عطر. زيد من «زيد عطر».</li>'; return; }
    if (!list.length) { ul.innerHTML = '<li class="d-empty">ما لقينا والو بهاد الاسم.</li>'; return; }
    ul.innerHTML = list.map((o) => `<li class="p-item${o.active ? "" : " is-removed"}${o.in_stock ? "" : " is-out"}" data-id="${o.id}">
      ${thumb(o.perfumes)}
      <div class="p-name"><b dir="ltr">${esc(o.perfumes?.name || o.perfume_id)}</b><small dir="ltr">${esc(o.perfumes?.brand || "")}${o.size ? " · " + esc(o.size) : ""}</small>
        ${o.active ? `<button type="button" class="p-link p-sizes-btn" data-act="sizes">📏 الأحجام والأثمنة${vlist(o).length > 1 ? ` (${vlist(o).length})` : ""}</button>` : ""}</div>
      ${o.active ? `${vlist(o).length > 1 ? `<span class="p-from">من ${fmt(o.price)} <em>درهم</em><small>${vlist(o).length} أحجام</small></span>`
        : `<label class="p-price"><span class="sr">الثمن</span><input type="number" inputmode="decimal" min="0" step="1" value="${o.price ?? ""}" data-act="price"><em>درهم</em></label>`}
        <label class="p-switch"><input type="checkbox" data-act="stock"${o.in_stock ? " checked" : ""}><span>${o.in_stock ? "متوفر" : "مقطوع"}</span></label>
        <button type="button" class="p-icon" data-act="remove" aria-label="حيد ${esc(o.perfumes?.name || "")}" title="حيد">✕</button>`
      : `<span class="p-tag">محيد</span><button type="button" class="p-link" data-act="restore">رجعو</button>`}
    </li>`).join("");
  };
  draw(); wireSearch(draw);
  el.addEventListener("change", async (e) => {
    if (e.target.closest(".p-sizes")) return;
    const li = e.target.closest(".p-item"); if (!li) return;
    const o = S.offers.find((x) => x.id === Number(li.dataset.id));
    if (e.target.dataset.act === "price") {
      const v = e.target.value === "" ? null : Number(e.target.value);
      if (v != null && (isNaN(v) || v < 0 || v > 100000)) { toast("الثمن ماشي صحيح.", true); e.target.value = o.price ?? ""; return; }
      // one size saved as a size: change its price there, so price and sizes stay the same thing
      const vs = vlist(o);
      if (vs.length === 1 && v) await save(o, { variants: [{ ...vs[0], price: v }] }, "تبدل الثمن ✓");
      else await save(o, { price: v }, "تبدل الثمن ✓");
    }
    if (e.target.dataset.act === "stock") { await save(o, { in_stock: e.target.checked }, e.target.checked ? "ولا متوفر ✓" : "ولا مقطوع ✓"); render(); }
  });
  el.addEventListener("click", async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === "sizes") {
      const li = e.target.closest(".p-item"), open = li.nextElementSibling && li.nextElementSibling.classList.contains("p-sizes-row");
      el.querySelectorAll(".p-sizes-row").forEach((x) => x.remove());
      if (!open) sizesEditor(li, S.offers.find((x) => x.id === Number(li.dataset.id)), draw);
      return;
    }
    if (act !== "remove" && act !== "restore") return;
    const o = S.offers.find((x) => x.id === Number(e.target.closest(".p-item").dataset.id));
    await save(o, { active: act === "restore" }, act === "restore" ? "رجع العطر ✓" : "تحيد العطر. تقدر ترجعو من بعد.");
    render();
  });
}

// the sizes a store sells for a perfume: saved sizes, else the single price as one size
const vlist = (o) => (Array.isArray(o.variants) ? o.variants : []);
const DECANTS = ["3ml", "5ml", "10ml", "20ml"];
const TYPE = { full: "قنينة كاملة", decant: "ديكونط" };
const normSize = (z) => String(z || "").trim().replace(/\s+/g, "").replace(/ML$/i, "ml");
// checklist of sizes: decants 3/5/10/20 ml, the bottle sizes, and any other size; each ticked size gets its price
function sizePicker(variants, bottleSize) {
  const has = (t, z) => variants.find((v) => v.type === t && normSize(v.size).toLowerCase() === normSize(z).toLowerCase());
  const bottles = [...new Set([normSize(bottleSize), "50ml", "100ml"].filter(Boolean))];
  const preset = (t, z) => { const v = has(t, z); return `<div class="p-chkrow${v ? " is-on" : ""}">
      <label class="p-chk"><input type="checkbox" data-type="${t}" data-size="${esc(z)}"${v ? " checked" : ""}><span dir="ltr">${esc(z.replace(/ml$/i, " ml"))}</span></label>
      <label class="p-price"><span class="sr">ثمن ${esc(z)}</span><input type="number" inputmode="decimal" min="0" step="1" placeholder="الثمن" value="${v ? v.price : ""}"${v ? "" : " disabled"}><em>درهم</em></label></div>`; };
  const presetKeys = new Set(DECANTS.map((z) => "decant|" + z.toLowerCase()).concat(bottles.map((z) => "full|" + z.toLowerCase())));
  const others = variants.filter((v) => !presetKeys.has(v.type + "|" + normSize(v.size).toLowerCase()));
  return `<div class="p-picker">
    <div class="p-pgroup"><h3>🧪 ديكونط</h3>${DECANTS.map((z) => preset("decant", z)).join("")}</div>
    <div class="p-pgroup"><h3>🧴 قنينة كاملة</h3>${bottles.map((z) => preset("full", z)).join("")}</div>
    <div class="p-pgroup p-others"><h3>حجم آخر</h3><div class="p-size-list">${others.map(customRow).join("")}</div>
      <button type="button" class="p-link" data-k="add">+ زيد حجم آخر</button></div></div>`;
}
function customRow(v = {}) {
  return `<div class="p-size" role="group">
    <label><span class="sr">النوع</span><select data-k="type">${Object.keys(TYPE).map((t) => `<option value="${t}"${(v.type || "decant") === t ? " selected" : ""}>${TYPE[t]}</option>`).join("")}</select></label>
    <label><span class="sr">الحجم</span><input data-k="size" maxlength="20" dir="ltr" placeholder="15ml" value="${esc(v.size || "")}"></label>
    <label class="p-price"><span class="sr">الثمن</span><input data-k="price" type="number" inputmode="decimal" min="0" step="1" placeholder="الثمن" value="${v.price ?? ""}"><em>درهم</em></label>
    <button type="button" class="p-icon" data-k="del" aria-label="حيد هاد الحجم">✕</button></div>`;
}
// read the ticked sizes; null (with a message) when something is missing
function readPicker(box) {
  const out = [], seen = new Set();
  const push = (type, size, pv) => {
    size = normSize(size); const price = Number(pv);
    if (!size) { toast("كتب الحجم (مثلاً 15ml).", true); return false; }
    if (pv === "" || !(price > 0) || price > 100000) { toast(`كتب الثمن ديال ${size}.`, true); return false; }
    const key = type + "|" + size.toLowerCase();
    if (seen.has(key)) { toast(`${size} مكتوب جوج مرات.`, true); return false; }
    seen.add(key); out.push({ type, size, price }); return true;
  };
  for (const c of box.querySelectorAll(".p-chkrow input[type=checkbox]:checked"))
    if (!push(c.dataset.type, c.dataset.size, c.closest(".p-chkrow").querySelector("input[type=number]").value)) return null;
  for (const r of box.querySelectorAll(".p-size")) {
    const size = r.querySelector("[data-k=size]").value, pv = r.querySelector("[data-k=price]").value;
    if (!size.trim() && !pv) continue;
    if (!push(r.querySelector("[data-k=type]").value, size, pv)) return null;
  }
  if (!out.length) { toast("ختار حجم واحد على الأقل وكتب الثمن ديالو.", true); return null; }
  if (out.length > 12) { toast("12 حجم هو الحد.", true); return null; }
  return out;
}
// opens the checklist under a list item; onSave(variants) returns true when saved
function openPicker(li, variants, bottleSize, label, onSave) {
  li.parentElement.querySelectorAll(".p-sizes-row").forEach((x) => x.remove());
  const box = document.createElement("li");
  box.className = "p-sizes-row";
  box.innerHTML = `<div class="p-sizes">
    <p class="p-small">علّم على الأحجام اللي كتبيع وكتب الثمن ديال كل واحد.</p>
    ${sizePicker(variants, bottleSize)}
    <div class="p-review"><span class="p-grow"></span><button type="button" class="p-link" data-k="cancel">إلغاء</button>
      <button type="button" class="d-btn" data-k="save">${label}</button></div></div>`;
  li.after(box);
  box.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const row = e.target.closest(".p-chkrow"), price = row.querySelector("input[type=number]");
    row.classList.toggle("is-on", e.target.checked); price.disabled = !e.target.checked;
    if (e.target.checked) price.focus();
  });
  box.addEventListener("click", async (e) => {
    const k = e.target.dataset.k;
    if (k === "add") { const l = box.querySelector(".p-size-list"); l.insertAdjacentHTML("beforeend", customRow()); l.lastElementChild.querySelector("[data-k=size]").focus(); }
    if (k === "del") e.target.closest(".p-size").remove();
    if (k === "cancel") box.remove();
    if (k === "save") {
      const out = readPicker(box); if (!out) return;
      e.target.disabled = true;
      const done = await onSave(out);
      e.target.disabled = false;
      if (done) box.remove();
    }
  });
  const first = box.querySelector("input[type=checkbox]:not(:checked)") ; if (!variants.length && first) first.focus();
}
function sizesEditor(li, o, done) {
  const start = vlist(o).length ? vlist(o) : (o.price ? [{ type: o.size_type === "decant" ? "decant" : "full", size: o.size || o.perfumes?.size || "", price: o.price }] : []);
  openPicker(li, start, o.perfumes?.size, "حفظ الأحجام", async (out) => {
    const ok = await save(o, { variants: out }, `تحفظو ${out.length} ${out.length === 1 ? "حجم" : "أحجام"} ✓`);
    if (ok) done(); return ok;
  });
}

async function save(o, patch, ok) {
  const { data, error } = await sb.from("offers").update(patch).eq("id", o.id).select("id, price, size, size_type, in_stock, active, updated_at, variants").single();
  if (error) { toast(errText(error), true); return false; }
  Object.assign(o, data); toast(ok); askPublish(); return true;
}
// after a change, ask for the quiz to be rebuilt (Apps Script groups the requests: one build every 10 minutes at most)
let publishTimer = null;
function askPublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => { teamCall("publish").catch(() => {}); }, 4000);
}

// add a perfume from the FragranceFlow catalogue
async function tabAdd() {
  const el = document.getElementById("tab");
  el.innerHTML = `${search("قلب فالكاتالوگ ديال FragranceFlow…")}<p class="p-small">ما لقيتيش العطر؟ صيفط «طلب عطر جديد» ونزيدوه.</p><ul class="p-list" id="list"><li class="d-empty">كنجيبو الكاتالوگ…</li></ul>`;
  const cat = await loadCatalog();
  const mine = {}; S.offers.forEach((o) => { mine[o.perfume_id] = o; });
  const draw = () => {
    const list = cat.filter((p) => match(p, S.q)).slice(0, 60);
    document.getElementById("list").innerHTML = list.length ? list.map((p) => {
      const have = mine[p.perfume_id];
      return `<li class="p-item p-item-add" data-pid="${esc(p.perfume_id)}">${thumb(p)}
        <div class="p-name"><b dir="ltr">${esc(p.name)}</b><small><span dir="ltr">${esc(p.brand)}</span> · ${GENDER[p.gender] || ""}</small></div>
        ${have && have.active ? `<span class="p-have"><span class="p-tag is-ok">عندك${vlist(have).length > 1 ? " · " + vlist(have).length + " أحجام" : ""}</span><button type="button" class="p-link" data-act="add">📏 زيد ولا بدل الأحجام</button></span>`
          : `<button type="button" class="d-btn p-add" data-act="add">${have ? "رجعو" : "+ زيد"}</button>`}</li>`;
    }).join("") : '<li class="d-empty">ما لقينا والو بهاد الاسم.</li>';
  };
  draw(); wireSearch(draw);
  el.addEventListener("click", (e) => {
    if (!e.target.dataset || e.target.dataset.act !== "add") return;
    const li = e.target.closest(".p-item"), pid = li.dataset.pid, p = cat.find((x) => x.perfume_id === pid), have = mine[pid];
    // a perfume the store already has: the same checklist, filled with its sizes (add a size or change a price)
    const start = !have ? [] : vlist(have).length ? vlist(have)
      : (have.price ? [{ type: have.size_type === "decant" ? "decant" : "full", size: have.size || p.size || "", price: have.price }] : []);
    const label = !have ? "إضافة العطر" : have.active ? "حفظ الأحجام" : "رجّع العطر";
    openPicker(li, start, p.size, label, async (variants) => {
      if (have) {
        const ok = await save(have, have.active ? { variants } : { active: true, in_stock: true, variants }, have.active ? `تحفظو ${variants.length} ${variants.length === 1 ? "حجم" : "أحجام"} ✓` : "رجع العطر ✓");
        if (ok) draw(); return ok;
      }
      const { data, error } = await sb.from("offers").insert({ store_id: S.store.id, perfume_id: pid, variants, in_stock: true })
        .select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, variants, perfumes(name, brand, gender, image_url, size)").single();
      if (error) { toast(errText(error), true); return false; }
      S.offers.push(data); mine[pid] = data; toast(`تزاد ${p.name} ✓`); askPublish(); draw(); return true;
    });
  });
}

// ask for a perfume that is not in the catalogue
function tabRequests() {
  const el = document.getElementById("tab");
  el.innerHTML = `<form id="f-req" class="p-form">
      <p class="p-small">العطر ما كاينش فالكاتالوگ؟ عطينا السمية والماركة، وكنزيدوه بالنوتات والتصنيف ديالو، ومن بعد كيبان عندك.</p>
      <div class="p-grid2"><label>سمية العطر *<input name="perfume_name" required minlength="2" maxlength="120" dir="auto"></label>
      <label>الماركة<input name="brand" maxlength="80" dir="auto"></label>
      <label>الحجم<input name="size" maxlength="40" placeholder="100ml" dir="ltr"></label>
      <label>الثمن عندك (درهم)<input name="price" type="number" min="0" step="1" inputmode="decimal"></label></div>
      <label>ملاحظة<textarea name="note" maxlength="500" rows="2"></textarea></label>
      <button class="d-btn" type="submit">صيفط الطلب</button></form>
    <h2 class="p-h2">الطلبات ديالك</h2>
    ${S.requests.length ? `<ul class="p-reqs">${S.requests.map((r) => `<li><div><b dir="auto">${esc(r.perfume_name)}</b><small dir="auto">${esc(r.brand)}${r.size ? " · " + esc(r.size) : ""} · ${dateAr(r.created_at)}</small>
      ${r.admin_note ? `<p class="p-small">${esc(r.admin_note)}</p>` : ""}</div><span class="p-tag is-${r.status}">${STATUS[r.status]}</span></li>`).join("")}</ul>` : '<p class="d-empty">مازال ما صيفطتي حتى طلب.</p>'}`;
  const f = document.getElementById("f-req");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { store_id: S.store.id, perfume_name: f.perfume_name.value.trim(), brand: f.brand.value.trim(), size: f.size.value.trim(),
      price: f.price.value === "" ? null : Number(f.price.value), note: f.note.value.trim() };
    if (row.perfume_name.length < 2) return toast("كتب سمية العطر.", true);
    const b = f.querySelector("button"); b.disabled = true;
    const { data, error } = await sb.from("requests").insert(row).select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    S.requests.unshift(data); toast("تصيفط الطلب ✓. غادي نراجعوه."); render();
  });
}

// store details the merchant may change (contact and branding); the rest is set by FragranceFlow
function tabSettings() {
  const s = S.store, el = document.getElementById("tab");
  const wa = String(s.whatsapp || "");
  el.innerHTML = `<form id="f-set" class="p-form" novalidate>
    <p class="p-small">هاد المعلومات كتبان للزبون فالكويز ديال متجرك. السمية والاشتراك كيبدلهم FragranceFlow.</p>
    <div class="p-grid2">
      <label>نمرة الواتساب<input name="whatsapp" inputmode="tel" dir="ltr" placeholder="0612345678" value="${esc(wa.startsWith("212") ? "0" + wa.slice(3) : wa)}"><small class="p-small">فين كيوصلوك طلبات الزبناء.</small></label>
      <label>المدينة<input name="city" maxlength="60" value="${esc(s.city || "")}"></label>
      <label>Instagram<input name="instagram" dir="ltr" placeholder="https://instagram.com/…" value="${esc(s.instagram || "")}"></label>
      <label>الموقع ديالك<input name="website" dir="ltr" placeholder="https://…" value="${esc(s.website || "")}"></label>
      <label>اللون ديال المتجر<span class="p-color"><input type="color" name="color" value="${/^#[0-9a-f]{6}$/i.test(s.color || "") ? esc(s.color) : "#5b35c8"}"><button type="button" class="p-link" id="b-nocolor">بلا لون</button></span></label>
    </div>
    <h2 class="p-h2">🎨 صفحة الكويز ديالك</h2>
    <p class="p-small">هادشي كيبان للزبون فأول صفحة الكويز. إلا خليتيهم خاويين، كيبان النص العادي.</p>
    <fieldset class="p-themes"><legend>الأجواء ديال الصفحة</legend>
      ${[["luxury", "💜 فاخر", "بنفسجي وذهبي"], ["oriental", "🌙 شرقي", "عنابي وذهبي، عود وعنبر"], ["modern", "🤍 عصري", "أبيض وأسود، بسيط"], ["natural", "🌿 طبيعي", "أخضر وبيج، ورود ونباتات"]].map(([k, l, d]) =>
        `<label class="p-theme"><input type="radio" name="theme" value="${k}"${(s.theme || "luxury") === k ? " checked" : ""}>
          <img src="/images/themes/${k}-thumb.webp" alt="" width="320" height="180" loading="lazy"><span><b>${l}</b><small>${d}</small></span></label>`).join("")}
      <p class="p-small">اللون ديالك وصورة الغلاف ديالك (إلا رفعتيها) كيتقدمو على ديال القالب.</p></fieldset>
    <div class="p-media">
      <div class="p-pic"><span class="p-pic-box p-pic-logo">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="اللوگو">` : esc((s.name || "?").slice(0, 2).toUpperCase())}</span>
        <div><b>اللوگو</b><small>مربع، PNG ولا JPG</small>
          <label class="d-btn p-upload">رفع اللوگو<input type="file" accept="image/png,image/jpeg,image/webp" data-up="logo_url" class="sr"></label>
          ${s.logo_url ? '<button type="button" class="p-link p-danger" data-rm="logo_url">حيد</button>' : ""}</div></div>
      <div class="p-pic p-pic-wide"><span class="p-pic-box p-pic-cover">${s.cover_url ? `<img src="${esc(s.cover_url)}" alt="صورة الغلاف">` : "<small>بلا صورة</small>"}</span>
        <div><b>صورة الغلاف</b><small>عريضة: المحل، الواجهة، ولا العطور ديالك</small>
          <label class="d-btn p-upload">رفع صورة<input type="file" accept="image/png,image/jpeg,image/webp" data-up="cover_url" class="sr"></label>
          ${s.cover_url ? '<button type="button" class="p-link p-danger" data-rm="cover_url">حيد</button>' : ""}</div></div>
    </div>
    <div class="p-grid2">
      <label>العنوان<input name="welcome_title" maxlength="80" value="${esc(s.welcome_title || "")}" placeholder="اكتشف بصمتك العطرية مع ${esc(s.name)}"></label>
      <label>جملة الترحيب<textarea name="welcome_text" maxlength="300" rows="2" placeholder="جاوب على أسئلة بسيطة، وخلي ${esc(s.name)} يكتاشف ليك العطور اللي كتشبه لذوقك.">${esc(s.welcome_text || "")}</textarea></label>
    </div>
    <button class="d-btn" type="submit">حفظ</button></form>
    <form id="f-pass" class="p-form p-pass" novalidate>
      <h2 class="p-h2">بدل كلمة السر</h2>
      <div class="p-grid2"><label>كلمة السر الجديدة (8 حروف ولا أكثر)<input type="password" name="p1" minlength="8" autocomplete="new-password" dir="ltr"></label>
      <label>عاودها<input type="password" name="p2" minlength="8" autocomplete="new-password" dir="ltr"></label></div>
      <button class="d-btn" type="submit">بدل كلمة السر</button></form>`;
  // pictures: resized in the browser, uploaded to the store's folder in Supabase Storage, then saved on the store
  el.addEventListener("change", async (e) => {
    const field = e.target.dataset && e.target.dataset.up, file = e.target.files && e.target.files[0];
    if (!field || !file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast("ختار صورة PNG ولا JPG.", true);
    if (file.size > 15 * 1024 * 1024) return toast("الصورة كبيرة بزاف (أكثر من 15 MB).", true);
    const lab = e.target.closest(".p-upload"); lab.classList.add("is-busy"); lab.firstChild.textContent = "كنرفعو…";
    try {
      const blob = field === "logo_url" ? await shrinkImage(file, 512, 512) : await shrinkImage(file, 1600, 900);
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      const path = `${s.id}/${field === "logo_url" ? "logo" : "cover"}-${Date.now()}.${ext}`;
      const up = await sb.storage.from("store-assets").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
      if (up.error) throw up.error;
      const url = sb.storage.from("store-assets").getPublicUrl(path).data.publicUrl;
      const { data, error } = await sb.from("stores").update({ [field]: url }).eq("id", s.id).select("*").single();
      if (error) throw error;
      Object.assign(s, data); toast("تحفظات الصورة ✓"); askPublish(); render();
    } catch (er) {
      lab.classList.remove("is-busy"); lab.firstChild.textContent = field === "logo_url" ? "رفع اللوگو" : "رفع صورة";
      toast(/bucket|not found/i.test(String(er && er.message)) ? "التخزين ما مزال مواجدش (010_store_page.sql)." : errText(er), true);
    }
  });
  el.addEventListener("click", async (e) => {
    const field = e.target.dataset && e.target.dataset.rm; if (!field) return;
    const { data, error } = await sb.from("stores").update({ [field]: "" }).eq("id", s.id).select("*").single();
    if (error) return toast(errText(error), true);
    Object.assign(s, data); toast("تحيدات ✓"); askPublish(); render();
  });
  const fp = document.getElementById("f-pass");
  fp.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (fp.p1.value.length < 8) return toast("كلمة السر خاصها 8 حروف ولا أكثر.", true);
    if (fp.p1.value !== fp.p2.value) return toast("جوج كلمات السر ما متشابهينش.", true);
    const { error } = await sb.auth.updateUser({ password: fp.p1.value });
    if (error) return toast(errText(error), true);
    fp.reset(); toast("تبدلات كلمة السر ✓");
  });
  const f = document.getElementById("f-set");
  let noColor = !s.color;
  document.getElementById("b-nocolor").onclick = () => { noColor = true; toast("غادي يتحيد اللون ملي تحفظ."); };
  f.color.addEventListener("input", () => { noColor = false; });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const https = (v) => !v || /^https:\/\/\S+$/.test(v);
    let w = f.whatsapp.value.replace(/\D/g, "").replace(/^00/, "");
    if (/^0[5-7]\d{8}$/.test(w)) w = "212" + w.slice(1);
    const row = { whatsapp: w, city: f.city.value.trim(), instagram: f.instagram.value.trim(), website: f.website.value.trim(),
      color: noColor ? "" : f.color.value.toLowerCase(), welcome_title: f.welcome_title.value.trim(), welcome_text: f.welcome_text.value.trim(),
      theme: (f.querySelector("input[name=theme]:checked") || {}).value || "luxury" };
    if (w && !/^\d{11,15}$/.test(w)) return toast("نمرة الواتساب ماشي صحيحة. مثال: 0612345678", true);
    for (const k of ["instagram", "website"]) if (!https(row[k])) return toast("الروابط خاصهم يبداو بـ https://", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const { data, error } = await sb.from("stores").update(row).eq("id", s.id).select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    Object.assign(s, data); toast("تحفظات المعلومات ✓"); askPublish(); render();
  });
}

// shrink a picture before upload (a phone photo of 5 MB becomes ~150 KB); WebP when the browser can, else JPEG
async function shrinkImage(file, maxW, maxH) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, maxW / img.width, maxH / img.height);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const as = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
  let b = await as("image/webp", 0.86);
  if (!b || b.type !== "image/webp") b = await as("image/jpeg", 0.86);
  return b;
}

// FragranceFlow team: create merchant logins (and new stores), new temporary passwords, remove access
function shareBox(r) {
  const url = location.origin + "/portal/";
  const msg = `مرحبا 👋\nهادا الحساب ديالك ف FragranceFlow:\n${url}\nالإيميل: ${r.email}\nكلمة السر المؤقتة: ${r.password}\nملي تدخل، بدل كلمة السر من «⚙️ إعدادات المتجر».`;
  return `<div class="p-share"><p><b>${esc(r.email)}</b></p>
    <p>كلمة السر المؤقتة: <code dir="ltr">${esc(r.password)}</code></p>
    <p class="p-small">ما غاديش تبان مرة أخرى. صيفطها للتاجر دابا.</p>
    <div class="p-review"><button type="button" class="d-btn" data-copy="${esc(msg)}">نسخ الرسالة</button>
    <a class="p-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">صيفط فالواتساب</a></div></div>`;
}
async function tabAccounts() {
  const el = document.getElementById("tab");
  el.innerHTML = `<form id="f-acc" class="p-form" novalidate>
      <h2 class="p-h2">حساب تاجر جديد</h2>
      <div class="p-grid2"><label>إيميل التاجر<input type="email" name="email" required dir="ltr" autocomplete="off"></label>
      <label>المتجر<select name="store"><option value="">+ متجر جديد</option>${S.stores.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.id)})</option>`).join("")}</select></label></div>
      <div class="p-grid2 p-newstore"><label>store_id (فالرابط)<input name="store_id" dir="ltr" placeholder="parfumerie-x" pattern="[a-z0-9][a-z0-9-]{1,40}"></label>
        <label>سمية المتجر<input name="name" maxlength="80"></label>
        <label>المدينة<input name="city" maxlength="60"></label>
        <label>نمرة الواتساب<input name="whatsapp" inputmode="tel" dir="ltr" placeholder="0612345678"></label></div>
      <p class="p-small">المتجر الجديد كيبدا بفترة تجريبية ديال 7 أيام. التاجر كياخد كلمة سر مؤقتة كتصيفطها ليه نتا.</p>
      <button class="d-btn" type="submit">صاوب الحساب</button></form>
    <div id="acc-result"></div>
    <h2 class="p-h2">الحسابات</h2><ul class="p-reqs" id="acc-list"><li class="d-empty">كنجيبو الحسابات…</li></ul>`;
  const f = document.getElementById("f-acc"), ns = el.querySelector(".p-newstore"), out = document.getElementById("acc-result");
  const toggle = () => { ns.hidden = !!f.store.value; };
  f.store.addEventListener("change", toggle); toggle();
  f.name.addEventListener("input", () => { if (!f.store_id.dataset.touched) f.store_id.value = f.name.value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); });
  f.store_id.addEventListener("input", () => { f.store_id.dataset.touched = "1"; });
  el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast("تنسخات ✓"); } catch (er) { toast("ما تنسخاتش. حددها بيدك.", true); } }
    if (t.dataset.reset) {
      t.disabled = true; const r = await teamCall("resetPassword", { user_id: t.dataset.reset }); t.disabled = false;
      if (r.error) return toast(r.message || "ما تبدلاتش.", true);
      out.innerHTML = shareBox(r); out.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (t.dataset.unlink) {
      const [uid, sid] = t.dataset.unlink.split("|");
      if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "متأكد؟"; return; }
      const r = await teamCall("unlinkMerchant", { user_id: uid, store_id: sid });
      if (r.error) return toast(r.message || "ما تحيدش.", true);
      toast("تحيد الوصول ✓"); loadList();
    }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { email: f.email.value.trim() };
    if (f.store.value) body.store_id = f.store.value;
    else Object.assign(body, { store_id: f.store_id.value.trim(), name: f.name.value.trim(), city: f.city.value.trim(), whatsapp: f.whatsapp.value.trim() });
    if (!/^\S+@\S+\.\S+$/.test(body.email)) return toast("كتب إيميل صحيح.", true);
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(body.store_id || "")) return toast("store_id: حروف صغار (a-z)، أرقام و - فقط.", true);
    if (!f.store.value && !body.name) return toast("كتب سمية المتجر.", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true; b.textContent = "كنصاوبو…";
    let r; try { r = await teamCall("createMerchant", body); } catch (er) { r = { error: "failed" }; }
    b.disabled = false; b.textContent = "صاوب الحساب";
    if (r.error) return toast(r.error === "invalid" ? "خاصك تكون admin." : (r.message || "ما تصاوبش الحساب."), true);
    out.innerHTML = r.new_user ? shareBox(r) : `<div class="p-share"><p><b>${esc(r.email)}</b> كان عندو حساب من قبل، وتربط دابا بـ <b>${esc(r.store_id)}</b>. كيدخل بكلمة السر ديالو.</p></div>`;
    if (r.store_created) { const all = await sb.from("stores").select("*").order("name"); if (!all.error) S.stores = all.data; }
    f.reset(); toggle(); toast("تصاوب ✓"); loadList();
  });
  async function loadList() {
    const ul = document.getElementById("acc-list");
    const r = await teamCall("merchants");
    if (r.error) { ul.innerHTML = `<li class="d-empty">${esc(r.message || "ما قدرناش نجيبو الحسابات. تأكد بلي Apps Script فيه المفتاح السري وتدار ليه New version.")}</li>`; return; }
    ul.innerHTML = r.accounts.length ? r.accounts.map((a) => `<li><div><b dir="ltr">${esc(a.email)}</b><small>${esc(a.store)} · ${a.last_sign_in_at ? "آخر دخول " + dateAr(a.last_sign_in_at) : "مازال ما دخلش"}</small></div>
      <div class="p-review"><button type="button" class="p-link" data-reset="${esc(a.user_id)}">كلمة سر جديدة</button>
      <button type="button" class="p-link p-danger" data-unlink="${esc(a.user_id)}|${esc(a.store_id)}">حيد الوصول</button></div></li>`).join("")
      : '<li class="d-empty">مازال ما كاين حتى حساب تاجر.</li>';
  }
  loadList();
}

// FragranceFlow team: the master catalogue (what the quiz knows about every perfume)
const P_FAMILY = { fresh: "منعش", citrus: "حمضي", woody: "خشبي", aquatic: "أكواتيك", oriental: "شرقي", sweet: "حلو", heavy: "ثقيل وعميق", fruity: "فاكهي", floral: "زهري", clean: "نظيف", musky: "مسكي" };
const P_OCCASION = { daily: "يومي / الخدمة", dates: "الأمسيات الخاصة", evening: "السهرات", travel: "السفر", allday: "كل الأوقات" };
const P_SEASON = { spring: "ربيع", summer: "صيف", autumn: "خريف", winter: "شتاء", allseasons: "طول العام" };
const P_WORLD = { "": "بلا تصنيف", designer: "Designer", niche: "Niche", ultra_niche: "Ultra-Niche", arabian: "Arabian" };
const P_GENDER = { men: "رجالي", women: "نسائي", unisex: "للجميع" };
const P_CONC = ["EDP", "EDT", "Parfum", "Extrait", "EDC"];
async function tabPerfumes() {
  const el = document.getElementById("tab");
  el.innerHTML = `<div class="p-review p-ptools">${search("قلب بالسمية ولا الماركة…")}<button type="button" class="d-btn" id="b-newp">+ عطر جديد</button></div>
    <p class="p-small">هادي هي القاعدة اللي كيخدم بيها المحرك. أي تبديل كيبان فالكويز من بعد النشر.</p><ul class="p-list" id="list"><li class="d-empty">كنجيبو العطور…</li></ul>`;
  const { data, error } = await sb.from("perfumes").select("*").order("perfume_id");
  if (error) { document.getElementById("list").innerHTML = `<li class="d-empty">${errText(error)}</li>`; return; }
  const all = data;
  const draw = () => {
    const list = all.filter((p) => match(p, S.q));
    document.getElementById("list").innerHTML = list.length ? list.map((p) => `<li class="p-item p-item-add${p.active ? "" : " is-removed"}" data-pid="${esc(p.perfume_id)}">${thumb(p)}
      <div class="p-name"><b dir="ltr">${esc(p.name)}</b><small><span dir="ltr">${esc(p.brand)}</span> · ${P_GENDER[p.gender] || ""} · <span dir="ltr">${esc(p.perfume_id)}</span>${p.ref_price ? " · " + fmt(p.ref_price) + " درهم" : ""}</small></div>
      <span class="p-have">${p.active ? "" : '<span class="p-tag">محبوس</span>'}<button type="button" class="p-link" data-edit="${esc(p.perfume_id)}">✏️ بدّل</button></span></li>`).join("")
      : '<li class="d-empty">ما لقينا والو بهاد الاسم.</li>';
  };
  draw(); wireSearch(draw);
  el.addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.edit;
    if (id) perfumeForm(e.target.closest(".p-item"), all.find((p) => p.perfume_id === id), (saved) => { Object.assign(all.find((p) => p.perfume_id === saved.perfume_id), saved); draw(); });
    if (e.target.id === "b-newp") perfumeForm(null, null, (saved) => { all.push(saved); draw(); });
  });
}
const chipSet = (name, labels, chosen) => `<div class="p-chips" role="group" aria-label="${name}">${Object.keys(labels).map((k) =>
  `<label class="p-chip2"><input type="checkbox" name="${name}" value="${k}"${chosen.includes(k) ? " checked" : ""}><span>${labels[k]}</span></label>`).join("")}</div>`;
const csv = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
// add or edit one perfume; prefill (from a request) fills a new one; onSaved(row)
async function perfumeForm(afterLi, p, onSaved, prefill = {}) {
  document.querySelectorAll(".p-pform-row").forEach((x) => x.remove());
  const isNew = !p;
  let id = p ? p.perfume_id : "";
  if (isNew) { const r = await sb.rpc("next_perfume_id"); if (r.error || !r.data) return toast("ما قدرناش نجيبو رقم جديد. تأكد من 009_phase3.sql.", true); id = r.data; }
  const v = p || { perfume_id: id, name: prefill.name || "", brand: prefill.brand || "", gender: "unisex", character: "", occasion: "", season: "", notes_top: "", notes_mid: "", notes_base: "",
    concentration: "EDP", size: prefill.size || "", size_type: "full", ref_price: prefill.price || null, world: "", image_url: "", active: true };
  const box = document.createElement(afterLi ? "li" : "div");
  box.className = "p-pform-row";
  box.innerHTML = `<form class="p-sizes p-pform" novalidate>
    <h3>${isNew ? "عطر جديد" : "تبديل العطر"} <span dir="ltr" class="p-tag">${esc(id)}</span></h3>
    <div class="p-grid2"><label>السمية *<input name="name" required maxlength="120" dir="ltr" value="${esc(v.name)}"></label>
      <label>الماركة *<input name="brand" required maxlength="80" dir="ltr" value="${esc(v.brand)}"></label>
      <label>لمن؟<select name="gender">${Object.keys(P_GENDER).map((k) => `<option value="${k}"${v.gender === k ? " selected" : ""}>${P_GENDER[k]}</option>`).join("")}</select></label>
      <label>العالم<select name="world">${Object.keys(P_WORLD).map((k) => `<option value="${k}"${(v.world || "") === k ? " selected" : ""}>${P_WORLD[k]}</option>`).join("")}</select></label></div>
    <fieldset><legend>العائلة (الطابع) *</legend>${chipSet("character", P_FAMILY, csv(v.character))}</fieldset>
    <fieldset><legend>المناسبة</legend>${chipSet("occasion", P_OCCASION, csv(v.occasion))}</fieldset>
    <fieldset><legend>الموسم</legend>${chipSet("season", P_SEASON, csv(v.season))}</fieldset>
    <div class="p-grid2"><label>نوتات الافتتاح (بفاصلة)<input name="notes_top" dir="ltr" value="${esc(v.notes_top)}" placeholder="Bergamot, Pepper"></label>
      <label>نوتات القلب<input name="notes_mid" dir="ltr" value="${esc(v.notes_mid)}"></label>
      <label>نوتات القاعدة<input name="notes_base" dir="ltr" value="${esc(v.notes_base)}"></label>
      <label>التركيز<select name="concentration">${P_CONC.map((c) => `<option${v.concentration === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>الحجم المرجعي<input name="size" dir="ltr" maxlength="20" value="${esc(v.size)}" placeholder="100ml"></label>
      <label>الثمن المرجعي (درهم)<input name="ref_price" type="number" min="0" step="1" value="${v.ref_price ?? ""}"></label>
      <label>رابط الصورة (https)<input name="image_url" dir="ltr" value="${esc(v.image_url)}" placeholder="https://res.cloudinary.com/…"></label>
      <label class="p-chk p-activechk"><input type="checkbox" name="active"${v.active ? " checked" : ""}><span>كيبان فالكويز</span></label></div>
    <div class="p-review"><span class="p-grow"></span><button type="button" class="p-link" data-k="cancel">إلغاء</button><button type="submit" class="d-btn">${isNew ? "زيد العطر" : "حفظ"}</button></div></form>`;
  if (afterLi) afterLi.after(box); else document.getElementById("list").before(box);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  const f = box.querySelector("form");
  box.querySelector("[data-k=cancel]").onclick = () => box.remove();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const checked = (n) => [...f.querySelectorAll(`input[name=${n}]:checked`)].map((x) => x.value).join(",");
    const row = { name: f.name.value.trim(), brand: f.brand.value.trim(), gender: f.gender.value, world: f.world.value,
      character: checked("character"), occasion: checked("occasion"), season: checked("season"),
      notes_top: csv(f.notes_top.value).join(","), notes_mid: csv(f.notes_mid.value).join(","), notes_base: csv(f.notes_base.value).join(","),
      concentration: f.concentration.value, size: f.size.value.trim(), ref_price: f.ref_price.value === "" ? null : Number(f.ref_price.value),
      image_url: f.image_url.value.trim(), active: f.active.checked };
    if (!row.name || !row.brand) return toast("السمية والماركة ضروريين.", true);
    if (!row.character) return toast("ختار عائلة وحدة على الأقل: المحرك كيحتاجها.", true);
    if (row.image_url && !/^https:\/\//.test(row.image_url)) return toast("رابط الصورة خاصو يبدا بـ https://", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const q = isNew ? sb.from("perfumes").insert({ perfume_id: id, size_type: "full", ...row }) : sb.from("perfumes").update(row).eq("perfume_id", id);
    const { data, error } = await q.select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    toast(isNew ? `تزاد ${data.name} ✓` : "تحفظ ✓"); S.catalog = null; box.remove(); onSaved(data);
  });
}

// FragranceFlow team: review requests from every store
async function tabReview() {
  const el = document.getElementById("tab");
  el.innerHTML = '<p class="d-empty">كنجيبو الطلبات…</p>';
  const { data, error } = await sb.from("requests").select("*, stores(name)").order("created_at", { ascending: false }).limit(200);
  if (error) { el.innerHTML = `<p class="d-msg">${errText(error)}</p>`; return; }
  const pend = data.filter((r) => r.status === "pending"), done = data.filter((r) => r.status !== "pending").slice(0, 30);
  const row = (r) => `<li data-id="${r.id}"><div><b dir="auto">${esc(r.perfume_name)}</b> <small dir="auto">${esc(r.brand)}${r.size ? " · " + esc(r.size) : ""}${r.price ? " · " + fmt(r.price) + " درهم" : ""}</small>
      <small>${esc(r.stores?.name || r.store_id)} · ${dateAr(r.created_at)}</small>${r.note ? `<p class="p-small">${esc(r.note)}</p>` : ""}</div>
      ${r.status === "pending" ? `<div class="p-review"><input placeholder="ملاحظة للتاجر (اختياري)" maxlength="300" data-note>
        <button type="button" class="d-btn" data-addp="${r.id}">قبول وزيد العطر</button><button type="button" class="p-link" data-st="approved">قبول فقط</button><button type="button" class="p-link" data-st="rejected">رفض</button></div>`
        : `<span class="p-tag is-${r.status}">${STATUS[r.status]}</span>`}</li>`;
  el.innerHTML = `<h2 class="p-h2">كيتسناو (${pend.length})</h2>${pend.length ? `<ul class="p-reqs">${pend.map(row).join("")}</ul>` : '<p class="d-empty">ما كاين حتى طلب كيتسنى ✅</p>'}
    <p class="p-small">ملي تقبل طلب: زيد العطر ف Perfumes بالتصنيف ديالو، ومن بعد التاجر يقدر يزيدو من «زيد عطر».</p>
    ${done.length ? `<h2 class="p-h2">آخر الطلبات اللي تراجعو</h2><ul class="p-reqs">${done.map(row).join("")}</ul>` : ""}`;
  el.addEventListener("click", async (e) => {
    const addp = e.target.dataset && e.target.dataset.addp;
    if (addp) {
      const r = data.find((x) => String(x.id) === addp), li = e.target.closest("li");
      return perfumeForm(li, null, async (saved) => {
        const note = li.querySelector("[data-note]").value.trim() || `تزاد للكاتالوگ (${saved.perfume_id}). تقدر تزيدو من «زيد عطر».`;
        const { error: er } = await sb.from("requests").update({ status: "approved", admin_note: note, perfume_id: saved.perfume_id }).eq("id", r.id);
        if (er) return toast(errText(er), true);
        toast("تقبل وتزاد العطر ✓"); tabReview();
      }, { name: r.perfume_name, brand: r.brand, size: r.size, price: r.price });
    }
    const st = e.target.dataset && e.target.dataset.st; if (!st) return;
    const li = e.target.closest("li"), note = li.querySelector("[data-note]").value.trim();
    const { error: er } = await sb.from("requests").update({ status: st, admin_note: note }).eq("id", Number(li.dataset.id));
    if (er) return toast(errText(er), true);
    toast(st === "approved" ? "تقبل ✓" : "ترفض"); tabReview();
  });
}

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") viewNewPassword();
  if (event === "SIGNED_IN" && !S.user) start();
});
if (!/type=recovery/.test(location.hash)) start();
