// Merchant portal: /portal/ — sign in (accounts are created by RihaFlow, no public sign-up),
// then the merchant manages its own offers (price, stock, remove/restore, add from the catalogue) and sends requests
// for perfumes that are not in the catalogue yet. Every rule is enforced again by Supabase row-level security.
import "./dashboard.css";
import "./portal.css";
import { sb } from "./supabase.js";
import { esc, fmt, FAMILY as FAM_LABEL, IMPRESSION as IMP_LABEL } from "./dash-common.js";
import { adminHTML, storesHTML, wireStoreSearch } from "./admin-view.js";
import { insightsHTML } from "./admin-insights.js";
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
const S = { user: null, admin: false, mode: "store", teamTab: "overview", days: 7, stores: [], store: null, tab: "home", offers: [], catalog: null, requests: [], q: "", flash: "" };
const GENDER = { men: "رجالي", women: "نسائي", unisex: "للجميع" };
const STATUS = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
const daysLeft = (d) => Math.ceil((new Date(d) - Date.now()) / 864e5);
const dateAr = (d) => new Date(d).toLocaleDateString("ar-MA", { day: "numeric", month: "long", year: "numeric" });

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "p-toast" + (bad ? " is-bad" : ""); t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}
const errText = (e) => {
  const m = String((e && (e.message || e.error_description)) || e || "");
  if (/Invalid login credentials/i.test(m)) return "البريد الإلكتروني أو كلمة السر غير صحيحة.";
  if (/Email not confirmed/i.test(m)) return "الحساب لم يُفعَّل بعد. تواصل مع RihaFlow.";
  if (/rate limit|too many/i.test(m)) return "حاولت عدة مرات. أعد المحاولة بعد قليل.";
  if (/Password should be at least/i.test(m)) return "يجب أن تتكون كلمة السر من 8 أحرف أو أكثر.";
  if (/network|fetch/i.test(m)) return "لا يوجد اتصال. تأكد من الإنترنت وأعد المحاولة.";
  return "حدث خطأ. أعد المحاولة.";
};

// ───────────── sign in / password ─────────────
function viewLogin(msg) {
  userBox.hidden = true;
  app.innerHTML = `<section class="p-auth d-card">
    <h1>فضاء التاجر</h1><p class="p-sub">سجّل الدخول لتعديل الأثمنة والتوفر وطلب عطور جديدة.</p>
    ${msg ? `<p class="p-alert">${esc(msg)}</p>` : ""}
    <form id="f-login" novalidate>
      <label>البريد الإلكتروني<input type="email" name="email" autocomplete="username" required dir="ltr"></label>
      <label>كلمة السر<input type="password" name="password" autocomplete="current-password" required dir="ltr"></label>
      <button class="d-btn p-wide" type="submit">دخول</button>
    </form>
    <button class="p-link" type="button" id="b-forgot">نسيت كلمة السر؟</button>
    <p class="p-small">ليس لديك حساب؟ تُنشئ RihaFlow الحسابات. تواصل معنا عبر الواتساب.</p>
  </section>`;
  const f = document.getElementById("f-login");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = f.querySelector("button"); b.disabled = true; b.textContent = "جارٍ الدخول…";
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { b.disabled = false; b.textContent = "دخول"; viewLogin(errText(error)); }
  });
  document.getElementById("b-forgot").addEventListener("click", viewForgot);
}

function viewForgot() {
  app.innerHTML = `<section class="p-auth d-card"><h1>نسيت كلمة السر؟</h1>
    <p class="p-sub">اكتب بريدك الإلكتروني، وسنرسل لك رابطاً لاختيار كلمة سر جديدة.</p>
    <form id="f-forgot"><label>البريد الإلكتروني<input type="email" name="email" autocomplete="username" required dir="ltr"></label>
    <button class="d-btn p-wide" type="submit">أرسل الرابط</button></form>
    <button class="p-link" type="button" id="b-back">العودة إلى الدخول</button></section>`;
  document.getElementById("b-back").addEventListener("click", () => viewLogin());
  const f = document.getElementById("f-forgot");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + "/portal/" });
    if (error) return toast(errText(error), true);
    app.querySelector(".p-auth").innerHTML = `<h1>تفقّد بريدك الإلكتروني 📩</h1><p class="p-sub">إذا كان لهذا البريد حساب، سيصلك رابط خلال دقائق. تفقّد أيضاً مجلد Spam.</p>
      <button class="p-link" type="button" onclick="location.reload()">العودة إلى الدخول</button>`;
  });
}

function viewNewPassword() {
  app.innerHTML = `<section class="p-auth d-card"><h1>كلمة سر جديدة</h1>
    <form id="f-new"><label>كلمة السر الجديدة (8 أحرف أو أكثر)<input type="password" name="p" minlength="8" autocomplete="new-password" required dir="ltr"></label>
    <button class="d-btn p-wide" type="submit">حفظ</button></form></section>`;
  const f = document.getElementById("f-new");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: f.p.value });
    if (error) return toast(errText(error), true);
    toast("تم تغيير كلمة السر ✓"); start();
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
    // the role column comes with 016_team_roles.sql; before it, everyone in admins is admin
    sb.from("admins").select("user_id, role").maybeSingle().then((r) => (r.error ? sb.from("admins").select("user_id").maybeSingle() : r)),
  ]);
  if (mem.error) { app.innerHTML = `<p class="d-msg">${errText(mem.error)}</p>`; return; }
  S.admin = !!(adm.data);
  S.role = S.admin ? (adm.data.role === "agent" ? "agent" : "admin") : "";
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
  if (!S.stores.length) { app.innerHTML = '<section class="d-card p-auth"><h1>لا يوجد متجر مرتبط بهذا الحساب</h1><p class="p-sub">تواصل مع RihaFlow لربط حسابك بالمتجر.</p></section>'; return; }
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
  S.queue = await loadQueue();
  render();
}
// one or two perfumes to ask the store about (review_queue, 014); nothing when the function is not there yet
async function loadQueue() {
  try { const q = await sb.rpc("review_queue", { p_store: S.store.id, p_n: 2 }); return q.error ? [] : (q.data || []); }
  catch (e) { return []; }
}

async function loadCatalog() {
  if (S.catalog) return S.catalog;
  const { data, error } = await sb.from("perfumes").select("perfume_id, name, brand, gender, size, ref_price, image_url").eq("active", true).order("brand").order("name");
  if (error) { toast(errText(error), true); return []; }
  return (S.catalog = data);
}
// one page of the catalogue matching what is typed (search_perfumes, 011): ready for thousands of perfumes,
// since Supabase returns at most 1000 rows per request. Before 011 is run: the old full list, filtered here.
async function findPerfumes(q, { all = false, off = 0, lim = 30, noImage = false } = {}) {
  if (noImage) return findWithoutImage(q, off, lim);
  const r = await sb.rpc("search_perfumes", { q: q || "", only_active: !all, lim, off });
  if (!r.error) return { rows: (r.data || []).map((x) => x.p), total: r.data && r.data.length ? Number(r.data[0].total) : 0 };
  if (!/search_perfumes|PGRST202|42883/.test((r.error.message || "") + r.error.code)) throw r.error;
  const src = all ? ((await sb.from("perfumes").select("*").order("brand").order("name")).data || []) : await loadCatalog();
  const hits = src.filter((p) => match(p, q));
  return { rows: hits.slice(off, off + lim), total: hits.length };
}
// the team's «بدون صورة» filter: active perfumes without a photo, every typed word in the name, brand or id
async function findWithoutImage(q, off, lim) {
  let req = sb.from("perfumes").select("*", { count: "exact" }).eq("active", true).or("image_url.is.null,image_url.eq.");
  for (const w of String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const x = w.replace(/[%_,()*\\]/g, "");
    if (x) req = req.or(`name.ilike.*${x}*,brand.ilike.*${x}*,perfume_id.ilike.*${x}*`);
  }
  const { data, error, count } = await req.order("brand").order("name").range(off, off + lim - 1);
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}
// a list fed page by page from the server: search as you type, «عرض المزيد» at the bottom
function serverList(opts, drawRow, onDraw) {
  const st = { rows: [], total: 0, seq: 0 };
  const listEl = document.getElementById("list"), more = document.getElementById("more"), cnt = document.getElementById("cnt");
  const draw = () => {
    listEl.innerHTML = st.rows.length ? st.rows.map(drawRow).join("") : '<li class="d-empty">لا توجد نتائج بهذا الاسم.</li>';
    if (cnt) cnt.textContent = st.total ? `${fmt(st.total)} عطر${S.q ? " تطابق البحث" : ""}` : "";
    more.hidden = st.rows.length >= st.total;
    if (onDraw) onDraw();
  };
  const load = async (reset) => {
    const my = ++st.seq;
    if (reset) listEl.innerHTML = '<li class="d-empty">جارٍ البحث…</li>';
    more.disabled = true;
    let res;
    try { res = await findPerfumes(S.q, { ...opts, off: reset ? 0 : st.rows.length }); }
    catch (e) { if (my === st.seq) listEl.innerHTML = `<li class="d-empty">${errText(e)}</li>`; more.disabled = false; return; }
    if (my !== st.seq) return;
    st.rows = reset ? res.rows : st.rows.concat(res.rows); st.total = res.total; more.disabled = false; draw();
  };
  let t;
  const q = document.getElementById("q");
  q.addEventListener("input", () => { S.q = q.value; clearTimeout(t); t = setTimeout(() => load(true), 250); });
  more.addEventListener("click", () => load(false));
  load(true);
  return { st, draw };
}

// ───────────── page ─────────────
function trialBanner(s) {
  if (s.subscription_status === "active") return "";
  if (s.subscription_status === "trial" && s.trial_ends_at) {
    const n = daysLeft(s.trial_ends_at);
    if (n > 0) return `<p class="p-banner">الفترة التجريبية: بقي لك <b>${n} ${n === 1 ? "يوم" : "أيام"}</b> (إلى غاية ${dateAr(s.trial_ends_at)}). عطورك تظهر للزبناء.</p>`;
    return `<p class="p-banner is-bad">انتهت الفترة التجريبية يوم ${dateAr(s.trial_ends_at)}. عطورك لم تعد تظهر للزبناء. تواصل مع RihaFlow لتفعيل الاشتراك.</p>`;
  }
  if (s.subscription_status === "paused" || s.subscription_status === "cancelled") return '<p class="p-banner is-bad">الاشتراك موقوف، وعطورك لا تظهر للزبناء. تواصل مع RihaFlow.</p>';
  return "";
}

// four sections instead of eight tabs: 🏠 home (what to do now), 🧴 my perfumes (+ add, import, request, opinion),
// 📊 numbers (statistics, monthly report), 🏪 my store (share the link, quiz page, details). S.tab is the view shown.
// line icons (one stroke style everywhere), drawn with the text color
const svg = (d, w = 20) => `<svg aria-hidden="true" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  perfumes: svg('<path d="M9 3h6v3H9z"/><rect x="6" y="6" width="12" height="15" rx="3"/>'),
  numbers: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  store: svg('<path d="M3 9 5 4h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v7h14v-7"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 18),
  chat: svg('<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z"/>', 18),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', 18),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
};
const SECTIONS = [["home", ICON.home, "الرئيسية"], ["perfumes", ICON.perfumes, "عطوري"], ["numbers", ICON.numbers, "الأرقام"], ["store", ICON.store, "متجري"]];
const greeting = () => (new Date().getHours() < 12 ? "صباح الخير" : "مساء الخير");
// the account's state in one chip next to the store's name
function subChip(s) {
  if (s.subscription_status === "active") return '<span class="p-chip is-ok"><i></i>الاشتراك مفعّل</span>';
  if (subBad(s)) return '<span class="p-chip is-bad"><i></i>لا يظهر للزبناء</span>';
  if (s.subscription_status === "trial" && s.trial_ends_at) { const n = daysLeft(s.trial_ends_at); return `<span class="p-chip is-trial"><i></i>تجربة · ${n} ${n === 1 ? "يوم" : "أيام"}</span>`; }
  return "";
}
const TAB_SEC = { home: "home", offers: "perfumes", add: "perfumes", import: "perfumes", requests: "perfumes", reviews: "perfumes", stats: "numbers", missed: "numbers", report: "numbers", settings: "store" };
const SEC_FIRST = { home: "home", perfumes: "offers", numbers: "stats", store: "settings" };
const hasPrice = (o) => vlist(o).some((v) => Number(v.price) > 0) || Number(o.price) > 0;
// steps the merchant ticked on this device (tried the quiz, shared the link); nothing breaks without storage
const onbKey = () => "ff_onb_" + S.store.id;
function onbGet() { try { return JSON.parse(localStorage.getItem(onbKey()) || "{}"); } catch (e) { return {}; } }
function onbSet(k) { try { localStorage.setItem(onbKey(), JSON.stringify({ ...onbGet(), [k]: 1 })); } catch (e) { /* private mode */ } }
const subBad = (s) => (s.subscription_status === "trial" && s.trial_ends_at && daysLeft(s.trial_ends_at) <= 0) || s.subscription_status === "paused" || s.subscription_status === "cancelled";

function render() {
  if (S.mode === "team") return renderTeam();
  const s = S.store, live = S.offers.filter((o) => o.active);
  if (!TAB_SEC[S.tab]) S.tab = "home";
  const sec = TAB_SEC[S.tab];
  const pending = S.requests.filter((r) => r.status === "pending").length;
  const sub = (items) => `<nav class="p-seg" aria-label="${SECTIONS.find((x) => x[0] === sec)[2]}">${items.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${S.tab === k}">${l}</button>`).join("")}</nav>`;
  let top = "";
  if (sec === "perfumes") {
    const back = { add: "أضف عطراً من الكتالوگ", import: "📥 استيراد لائحة", requests: "طلب عطر غير موجود" }[S.tab];
    top = back ? `<div class="p-subhead"><button type="button" class="p-link" data-tab="offers">→ العودة إلى عطوري</button><h2>${back}</h2></div>`
      : `<div class="p-perf-bar">${sub([["offers", `عطوري <small>${live.length}</small>`], ["reviews", "⭐ رأيك فيها"]])}
          <button type="button" class="d-btn" id="b-add-menu" aria-expanded="${!!S.addMenu}" aria-controls="p-addmenu">+ أضف عطوراً</button></div>
        <div class="p-addmenu" id="p-addmenu"${S.addMenu ? "" : " hidden"}>
          <button type="button" data-tab="add"><b>🔎 عطر بعطر</b><span>ابحث في الكتالوگ وأضف الثمن</span></button>
          <button type="button" data-tab="import"><b>📥 لائحة كاملة</b><span>ألصق لائحتك أو ملف Excel</span></button>
          <button type="button" data-tab="requests"><b>📝 عطر غير موجود${pending ? ` <small>${pending}</small>` : ""}</b><span>اطلبه وسنضيفه إلى الكتالوگ</span></button>
        </div>`;
  }
  if (sec === "numbers") top = sub([["stats", "الإحصائيات"], ["missed", "🔍 ما لم يجدوه"], ["report", "التقرير الشهري"]]);
  const wide = sec === "home" || sec === "numbers";
  app.innerHTML = `
    ${S.admin ? '<div class="p-backbar"><button type="button" class="p-link" id="b-team">← العودة إلى اللوحة العامة</button><span>أنت ترى المتجر كما يراه التاجر</span></div>' : ""}
    <section class="d-head p-head">
      <span class="d-seal" style="${s.color ? "background:" + esc(s.color) : ""}">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : esc(s.name.slice(0, 2).toUpperCase())}</span>
      <div><p class="p-hello">${greeting()}</p><h1>${esc(s.name)}</h1></div>
      ${subChip(s)}
      ${!S.admin && S.stores.length > 1 ? `<label class="p-pick">المتجر<select id="s-store">${S.stores.map((x) => `<option value="${esc(x.id)}"${x.id === s.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    </section>
    <nav class="p-nav" aria-label="الأقسام">${SECTIONS.map(([k, i, l]) => `<button type="button" data-sec="${k}"${sec === k ? ' aria-current="page"' : ""}><span class="p-nav-i">${i}</span>${l}</button>`).join("")}</nav>
    ${sec !== "home" && subBad(s) ? trialBanner(s) : ""}
    ${top}
    ${sec === "store" ? `<h2 class="p-sec-h">شارك متجرك</h2>${linkCard(s)}<h2 class="p-sec-h">المعلومات وصفحة الكويز</h2>` : ""}
    <section id="tab" class="${wide ? "p-wide-tab" : "d-card p-panel"}"></section>
    ${sec === "perfumes" ? '<p class="d-foot">تظهر التعديلات للزبناء في الكويز خلال 10 إلى 15 دقيقة.</p>' : ""}`;
  app.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => { S.tab = SEC_FIRST[b.dataset.sec]; S.q = ""; S.addMenu = false; render(); scrollTo(0, 0); }));
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; S.q = ""; S.addMenu = false; render(); }));
  const am = document.getElementById("b-add-menu");
  if (am) am.addEventListener("click", () => { S.addMenu = !S.addMenu; const m = document.getElementById("p-addmenu"); m.hidden = !S.addMenu; am.setAttribute("aria-expanded", S.addMenu); });
  const pick = document.getElementById("s-store");
  if (pick) pick.addEventListener("change", () => { S.store = S.stores.find((x) => x.id === pick.value); loadStore(); });
  if (sec === "store") wireLinkCard(s);
  const back = document.getElementById("b-team");
  if (back) back.addEventListener("click", () => { S.mode = "team"; sessionStorage.setItem("ff_mode", "team"); renderTeam(); });
  ({ home: tabHome, offers: tabOffers, add: tabAdd, requests: tabRequests, reviews: tabReviews, import: tabImport, settings: tabSettings, stats: tabStats, missed: tabMissed, report: tabReport }[S.tab] || tabHome)();
}

// 🏠 home: the account's state, the first steps (until they are all done), this week's numbers, one question
function tabHome() {
  const s = S.store, el = document.getElementById("tab"), live = S.offers.filter((o) => o.active), f = onbGet();
  const noPrice = live.filter((o) => !hasPrice(o)).length;
  const steps = [
    ["perfumes", "أضف عطورك", live.length ? `${fmt(live.length)} عطر في الكويز` : "العطور التي تبيعها، ليقترحها الكويز على الزبناء", live.length > 0, '<button type="button" class="d-btn" data-go="offers" data-menu="1">أضف عطوراً</button>'],
    ["prices", "أضف الأثمنة", noPrice ? `${fmt(noPrice)} عطر بدون ثمن` : "يرى الزبون الثمن قبل أن يتواصل معك", live.length > 0 && !noPrice, '<button type="button" class="d-btn ghost" data-go="offers">الأثمنة</button>'],
    ["tried", "جرّب الكويز كزبون", "شاهد ما سيراه زبونك", !!f.tried, `<a class="d-btn ghost" target="_blank" rel="noopener" href="${esc(storeLink(s))}#quiz" data-onb="tried">جرّب</a>`],
    ["shared", "شارك رابط متجرك", "في البيو على Instagram، أو عبر الواتساب، أو QR في المحل", !!f.shared, '<button type="button" class="d-btn ghost" id="b-home-copy">انسخ الرابط</button>'],
  ];
  const done = steps.filter((x) => x[3]).length, allDone = done === steps.length;
  const status = subBad(s) ? trialBanner(s) : "";   // the chip in the header says the rest
  el.innerHTML = `${status}
    <section class="p-hero" aria-labelledby="p-week-t">
      <div class="p-hero-top"><h2 id="p-week-t">زيارات الكويز · آخر 7 أيام</h2><span class="p-hero-diff" id="p-hero-diff" hidden></span></div>
      <p class="p-hero-n" id="p-hero-n">…</p>
      <div class="p-hero-bars" id="p-hero-bars" aria-hidden="true">${"<i></i>".repeat(7)}</div>
      <div class="p-hero-days" id="p-hero-days"><span></span><span>اليوم</span></div>
    </section>
    <div class="p-tiles">
      <div class="p-tile k-done"><span class="p-tile-i">${ICON.check}</span><b id="p-t-done">…</b><span>أكملوا الكويز</span></div>
      <div class="p-tile k-wa"><span class="p-tile-i">${ICON.chat}</span><b id="p-t-wa">…</b><span>نقرات الواتساب</span></div>
    </div>
    <p class="p-week-foot" id="p-week"><button type="button" class="p-link" data-go="stats">كل الأرقام ←</button></p>
    <div id="p-miss-home"></div>
    ${allDone ? "" : `<section class="d-card p-steps" aria-labelledby="p-steps-t">
      <div class="p-steps-head"><h2 id="p-steps-t">ابدأ من هنا</h2><span>${done} من ${steps.length}</span></div>
      <span class="p-rv-bar" aria-hidden="true"><i style="width:${(done / steps.length) * 100}%"></i></span>
      <ol>${steps.map(([k, l, hint, ok, act], i) => `<li class="${ok ? "is-done" : ""}"><span class="p-step-n" aria-hidden="true">${ok ? "✓" : i + 1}</span>
        <div><b>${l}</b><small>${hint}</small></div>${ok ? '<span class="p-step-ok">تم</span>' : act}</li>`).join("")}</ol>
    </section>`}
    <div id="p-rvq"></div>
    ${allDone ? `<section class="d-card p-quicklink"><h2>🔗 رابط متجرك</h2>
      <div class="p-linkrow"><input readonly dir="ltr" value="${esc(storeLink(s))}" aria-label="رابط متجرك" id="p-home-url"><button type="button" class="d-btn" id="b-home-copy">نسخ</button></div>
      <button type="button" class="p-link" data-go="settings">QR، الواتساب، وموقعك ←</button></section>` : ""}`;
  el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.go; S.q = ""; S.addMenu = !!b.dataset.menu; render(); scrollTo(0, 0); }));
  el.querySelectorAll("[data-onb]").forEach((a) => a.addEventListener("click", () => { onbSet(a.dataset.onb); setTimeout(render, 300); }));
  const cp = document.getElementById("b-home-copy");
  if (cp) cp.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(storeLink(s)); toast("تم نسخ الرابط ✓ ألصقه في البيو أو أرسله للزبناء."); }
    catch (e) { toast(storeLink(s)); }
    onbSet("shared"); if (!allDone) setTimeout(render, 600);
  });
  drawQueue();
  week();
  missHome();
  // what customers asked for without finding it (018): one line here, the detail in 📊 الأرقام
  async function missHome() {
    const d = await loadMissed(30), box = document.getElementById("p-miss-home");
    if (S.tab !== "home" || !box || d.error || !d.missed) return;
    const x = (d.requests || [])[0];
    box.innerHTML = `<section class="d-card p-miss-home"><span class="p-tile-i">${ICON.search}</span><div><h2>${fmt(d.missed)} ${d.missed === 1 ? "زبون لم يجد" : "زبائن لم يجدوا"} ما طلبوه</h2>
      <p class="p-small">آخر 30 يوماً${x ? ` · الأكثر طلباً: ${esc(M_GENDER[x.gender] || "")}${x.gender ? " · " : ""}${esc(FAM_LABEL[x.family] || x.family)}` : ""}</p></div>
      <button type="button" class="d-btn ghost" id="b-miss-go">ماذا طلبوا؟ ←</button></section>`;
    document.getElementById("b-miss-go").addEventListener("click", () => { S.tab = "missed"; render(); scrollTo(0, 0); });
  }
  async function week() {
    let d; try { d = await fetchStats({ days: 7 }); } catch (e) { d = { error: "net" }; }
    const box = document.getElementById("p-week");
    if (S.tab !== "home" || !box) return;
    if (d.error) { box.innerHTML = `<p class="d-msg">${statsError(d)}</p>`; return; }
    const t = d.totals || {};
    if (t.experiences && !f.shared) { onbSet("shared"); return render(); }   // customers came: the link was shared
    const set = (id, v) => { const x = document.getElementById(id); if (x) x.textContent = fmt(v || 0); };
    set("p-hero-n", t.experiences); set("p-t-done", t.completed); set("p-t-wa", t.whatsapp);
    const series = (d.series && d.series.experiences) || [], top = Math.max(1, ...series);
    document.getElementById("p-hero-bars").innerHTML = series.map((v, i) => `<i class="${i === series.length - 1 ? "is-today" : ""}" style="height:${12 + (v / top) * 52}px"></i>`).join("");
    const first = (d.days || [])[0];
    if (first) document.querySelector("#p-hero-days span").textContent = new Date(first + "T12:00:00").toLocaleDateString("ar-MA", { weekday: "long" });
    const prev = d.prev && d.prev.experiences, diff = document.getElementById("p-hero-diff");
    if (prev != null && diff) { const n = (t.experiences || 0) - prev; diff.textContent = n === 0 ? "مثل الأسبوع السابق" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))} عن الأسبوع السابق`; diff.hidden = false; }
    if (!t.experiences) box.insertAdjacentHTML("afterbegin", '<span class="p-small">تظهر الأرقام هنا عندما يبدأ الزبناء في اجتياز الكويز. شارك الرابط لتبدأ.</span>');
  }
}

// ───────────── 📥 import a list: paste or upload, match against the catalogue (015), confirm, add ─────────────
// one line of the merchant's list → name to look for, size, bottle or decant, price (only what is clearly written)
const CUR = "(?:dh|dhs|mad|درهم|د\\.?م)";
function parseLine(raw) {
  let t = " " + String(raw || "").replace(/\s+/g, " ").trim() + " ", price = null, size = "";
  const m1 = t.match(new RegExp("(\\d+(?:[.,]\\d+)?)\\s*" + CUR + "(?=[\\s,;|]|$)", "i"));
  if (m1) { price = Number(m1[1].replace(",", ".")); t = t.replace(m1[0], " "); }
  const ms = t.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ms) { size = ms[1].replace(",", ".") + "ml"; t = t.replace(ms[0], " "); }
  if (price == null) { // a last number is a price only next to a size or after a separator («… 100ml 350», «…; 350»)
    const mt = t.match(/(?:[;,|\t]\s*|\s-\s|\s)(\d{2,6}(?:[.,]\d+)?)\s*$/);
    if (mt && (size || /[;,|\t]|\s-\s/.test(mt[0]))) { price = Number(mt[1].replace(",", ".")); t = t.slice(0, t.length - mt[0].length); }
  }
  const decWord = /\b(decants?|d[ée]cant|échantillon|sample)\b|ديكونط|تقسيط/i.test(raw);
  const type = decWord || (size && parseFloat(size) <= 20) ? "decant" : "full";
  const name = t.replace(/[;,|\t]+/g, " ").replace(/\b(decants?|d[ée]cant)\b|ديكونط/gi, " ").replace(/\s+/g, " ").trim();
  return { raw: String(raw).trim(), name, size, price: Number.isFinite(price) ? price : null, type };
}
// a spreadsheet (rows of cells) → lines; a header with name / brand / size / price columns is used when there is one
function rowsToItems(rows) {
  rows = rows.map((r) => r.map((c) => (c == null ? "" : String(c).trim()))).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const h = rows[0].map((c) => c.toLowerCase()), col = (re) => h.findIndex((c) => re.test(c));
  const ni = col(/^(name|nom|perfume|parfum|اسم|سمية|العطر|عطر)/), bi = col(/^(brand|marque|الماركة|ماركة)/), si = col(/^(size|taille|volume|الحجم|حجم)/), pi = col(/^(price|prix|الثمن|ثمن)/);
  if (ni < 0) return rows.map((r) => parseLine(r.join(" ")));
  return rows.slice(1).map((r) => {
    const base = parseLine([bi >= 0 ? r[bi] : "", r[ni]].join(" "));
    if (si >= 0 && r[si]) { const z = String(r[si]).match(/\d+(?:[.,]\d+)?/); if (z) { base.size = z[0].replace(",", ".") + "ml"; base.type = parseFloat(z[0]) <= 20 ? "decant" : "full"; } }
    if (pi >= 0 && r[pi] !== "") { const v = Number(String(r[pi]).replace(/[^\d.,]/g, "").replace(",", ".")); if (Number.isFinite(v) && v > 0) base.price = v; }
    base.raw = r.filter(Boolean).join(" · ");
    return base;
  }).filter((x) => x.name);
}
const IMP = { rows: [], step: "input", text: "", result: null, sendReq: true };
function impStatus(x) {
  const c = x.cands || [], a = c[0], b = c[1];
  if (!a) return "none";
  return a.score >= 0.999 || (a.score >= 0.9 && (!b || a.score - b.score >= 0.1)) ? "sure" : "check";
}
function tabImport() {
  const el = document.getElementById("tab");
  if (IMP.step === "review") return drawImport(el);
  if (IMP.step === "done") return drawImportDone(el);
  el.innerHTML = `<div class="p-imp">
    <h2 class="p-imp-h">أضف عدة عطور دفعة واحدة</h2>
    <ol class="p-imp-how"><li>الصق لائحة عطورك هنا: <b>عطر في كل سطر</b>.</li><li>نبحث عن كل عطر في الكتالوگ.</li><li>راجع العطور، ثم اضغط «أضف». الحجم والثمن اختياريان، ويمكنك إضافتهما لاحقاً.</li></ol>
    <textarea id="imp-text" rows="8" dir="auto" aria-label="لائحة العطور" placeholder="مثال:&#10;Lattafa Khamrah 100ml 350&#10;Dior Sauvage 100ml 1200&#10;Yara 10ml 60">${esc(IMP.text)}</textarea>
    <div class="p-imp-acts">
      <button type="button" class="d-btn" id="imp-go">ابحث عن العطور</button>
      <label class="p-link p-imp-file">أو ارفع ملف Excel<input type="file" id="imp-file" class="sr" accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    </div>
    <p class="p-small" id="imp-msg" role="status"></p></div>`;
  const msg = el.querySelector("#imp-msg");
  el.querySelector("#imp-go").addEventListener("click", () => {
    IMP.text = el.querySelector("#imp-text").value;
    const items = IMP.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 1).map(parseLine).filter((x) => x.name);
    runMatch(items, msg);
  });
  el.querySelector("#imp-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    msg.textContent = "جارٍ قراءة الملف…";
    try {
      let rows;
      if (/\.xlsx$/i.test(f.name)) { const { readSheet } = await import("read-excel-file/browser"); rows = await readSheet(f); }
      else { const txt = await f.text(); rows = txt.split(/\r?\n/).map((l) => l.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, ""))); }
      runMatch(rowsToItems(rows), msg);
    } catch (err) { msg.textContent = "تعذّرت قراءة هذا الملف. جرّب ملف Excel أو الصق اللائحة."; }
  });
}
async function runMatch(items, msg) {
  if (!items.length) { msg.textContent = "لم نجد أي عطر في اللائحة."; return; }
  if (items.length > 300) { msg.textContent = `اللائحة فيها ${fmt(items.length)} سطراً. أرسل 300 سطر كحد أقصى في كل مرة.`; return; }
  msg.textContent = `جارٍ البحث عن ${fmt(items.length)} عطر…`;
  const r = await sb.rpc("match_perfumes", { p_items: items.map((x) => x.name) });
  if (r.error) { msg.textContent = /match_perfumes|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "يعمل الاستيراد بعد تشغيل 015_match_perfumes.sql في Supabase." : errText(r.error); return; }
  const have = new Set(S.offers.filter((o) => o.active).map((o) => o.perfume_id.toUpperCase()));
  IMP.rows = items.map((x, i) => {
    const cands = ((r.data || [])[i] || {}).candidates || [];
    const row = { ...x, cands, request: true };
    row.status = impStatus(row);
    row.pick = row.status === "sure" ? cands[0].perfume_id : "";
    if (row.pick && have.has(row.pick.toUpperCase())) row.status = "have";
    return row;
  });
  IMP.step = "review"; tabImport();
}
function drawImport(el) {
  const have = new Set(S.offers.filter((o) => o.active).map((o) => o.perfume_id.toUpperCase()));
  const rows = IMP.rows.map((x, i) => ({ x, i })), owned = (x) => x.pick && have.has(x.pick.toUpperCase());
  const found = rows.filter(({ x }) => x.pick && !owned(x)), ask = rows.filter(({ x }) => !x.pick && x.status === "check" && !x.dropped);
  const none = rows.filter(({ x }) => !x.pick && (x.status === "none" || x.dropped)), already = rows.filter(({ x }) => owned(x)).length;
  const groups = new Set(found.map(({ x }) => x.pick)).size, missing = found.filter(({ x }) => !(x.price > 0) || !x.size).length;
  const name = (x) => (x.cands.find((c) => c.perfume_id === x.pick) || {}).name || x.name, brand = (x) => (x.cands.find((c) => c.perfume_id === x.pick) || {}).brand || "";
  const head = [`وجدنا <b>${fmt(groups)}</b> عطر`, ask.length ? `<b>${fmt(ask.length)}</b> تحتاج اختيارك` : "", none.length ? `<b>${fmt(none.length)}</b> لم نجدها` : "", already ? `${fmt(already)} موجودة عندك` : ""].filter(Boolean).join(" · ");
  el.innerHTML = `<div class="p-imp">
    <p class="p-imp-top">${head}</p>
    ${ask.length ? `<section class="p-imp-sec p-imp-ask"><h3>🤔 أي عطر تقصد؟ <small>اضغط على العطر الصحيح</small></h3>
      ${ask.map(({ x, i }) => `<div class="p-imp-q" data-i="${i}"><p dir="auto">«${esc(x.raw)}»</p><div class="p-imp-btns">
        ${x.cands.map((c) => `<button type="button" class="p-imp-pick" data-pick="${esc(c.perfume_id)}"><b dir="ltr">${esc(c.name)}</b><small dir="ltr">${esc(c.brand)}</small></button>`).join("")}
        <button type="button" class="p-imp-pick is-none" data-drop>غير موجود</button></div></div>`).join("")}</section>` : ""}
    ${found.length ? `<section class="p-imp-sec"><h3>✅ ستتم إضافتها <small>الحجم والثمن اختياريان</small></h3>
      <ul class="p-imp-found">${found.map(({ x, i }) => `<li data-i="${i}"><div class="p-imp-n"><b dir="ltr">${esc(name(x))}</b><small dir="ltr">${esc(brand(x))}</small>${x.type === "decant" ? '<span class="p-tag">ديكونط</span>' : ""}</div>
        <input data-f="size" value="${esc(x.size)}" placeholder="الحجم" aria-label="الحجم" dir="ltr" maxlength="20" class="${x.size ? "" : "is-miss"}">
        <input data-f="price" type="number" min="1" step="1" inputmode="decimal" value="${x.price ?? ""}" placeholder="الثمن" aria-label="الثمن بالدرهم" class="${x.price > 0 ? "" : "is-miss"}">
        <button type="button" class="p-imp-x" data-x aria-label="احذف ${esc(name(x))}">✕</button></li>`).join("")}</ul></section>` : ""}
    ${none.length ? `<section class="p-imp-sec p-imp-none"><h3>❌ لم نجدها</h3>
      <p class="p-small" dir="auto">${none.map(({ x }) => esc(x.name)).join(" · ")}</p>
      <label class="p-chk"><input type="checkbox" id="imp-req"${IMP.sendReq !== false ? " checked" : ""}> أرسلها لفريق RihaFlow لإضافتها إلى الكتالوگ</label></section>` : ""}
    <div class="p-imp-foot"></div></div>`;
  const row = (n) => IMP.rows[Number(n.closest("[data-i]").dataset.i)];
  el.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { const x = row(b); x.pick = b.dataset.pick; drawImport(el); }));
  el.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { row(b).dropped = true; drawImport(el); }));
  el.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => { const x = row(b); x.pick = ""; x.removed = true; x.dropped = false; x.status = "removed"; drawImport(el); }));
  el.querySelectorAll("[data-f]").forEach((f) => f.addEventListener("input", () => {
    const x = row(f), k = f.dataset.f;
    if (k === "price") x.price = f.value === "" ? null : Number(f.value);
    else { x.size = f.value.trim(); if (/^\d+([.,]\d+)?$/.test(x.size)) { x.size += "ml"; f.value = x.size; } if (parseFloat(x.size)) x.type = parseFloat(x.size) <= 20 ? "decant" : "full"; }
    f.classList.toggle("is-miss", k === "price" ? !(x.price > 0) : !x.size);
    importFoot(el);
  }));
  const req = el.querySelector("#imp-req");
  if (req) req.addEventListener("change", () => { IMP.sendReq = req.checked; importFoot(el); });
  importFoot(el);
}
// the bar at the bottom: what is missing and the button (redrawn alone while typing, so the list keeps its focus)
function importFoot(el) {
  const have = new Set(S.offers.filter((o) => o.active).map((o) => o.perfume_id.toUpperCase()));
  const found = IMP.rows.filter((x) => x.pick && !have.has(x.pick.toUpperCase()));
  const groups = new Set(found.map((x) => x.pick)).size, missing = found.filter((x) => !(x.price > 0) || !x.size).length;
  const reqs = IMP.sendReq === false ? 0 : IMP.rows.filter((x) => !x.pick && (x.status === "none" || x.dropped)).length;
  const foot = el.querySelector(".p-imp-foot");
  // size and price are optional: the perfume is added anyway and shows in the quiz; the price can come later
  foot.innerHTML = `${missing ? `<p class="p-imp-note">${fmt(missing)} بدون حجم أو ثمن (باللون البرتقالي). ستُضاف وتظهر في الكويز، ويمكنك إضافة الثمن لاحقاً من «عطوري».</p>` : ""}
    <div class="p-imp-acts"><button type="button" class="d-btn" id="imp-save"${groups || reqs ? "" : " disabled"}>${groups ? `أضف ${fmt(groups)} عطر` : "أرسل الطلبات"}</button>
      <button type="button" class="p-link" id="imp-back">رجوع</button></div>`;
  foot.querySelector("#imp-back").addEventListener("click", () => { IMP.step = "input"; tabImport(); });
  foot.querySelector("#imp-save").addEventListener("click", () => saveImport(el));
}
async function saveImport(el) {
  const btn = el.querySelector("#imp-save"); btn.disabled = true; btn.textContent = "جارٍ الإضافة…";
  const have = new Set(S.offers.filter((o) => o.active).map((o) => o.perfume_id.toUpperCase()));
  const groups = new Map();
  IMP.rows.filter((x) => x.pick && !have.has(x.pick.toUpperCase())).forEach((x) => {
    const g = groups.get(x.pick) || { pick: x.pick, name: (x.cands.find((c) => c.perfume_id === x.pick) || {}).name || x.name, variants: [], rest: [] };
    const size = (x.size || "").trim(), type = x.type === "decant" ? "decant" : "full";
    // a size with its price becomes one of the offer's sizes; a line without one is kept as it is (added without a price)
    if (size && x.price > 0) {
      const key = type + "|" + size.toLowerCase();
      if (!g.variants.some((v) => v.type + "|" + v.size.toLowerCase() === key)) g.variants.push({ type, size, price: x.price });
    } else g.rest.push({ type, size, price: x.price > 0 ? x.price : null });
    groups.set(x.pick, g);
  });
  const added = [], failed = [];
  let unpriced = 0;
  for (const g of groups.values()) {
    const first = g.rest[0] || { type: "full", size: "", price: null };
    const row = g.variants.length ? { variants: g.variants }
      : { variants: [], size: first.size, size_type: first.type, price: first.price };
    if (!g.variants.length && !first.price) unpriced++;
    const { data, error } = await sb.from("offers").insert({ store_id: S.store.id, perfume_id: g.pick, in_stock: true, ...row })
      .select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, variants, perfumes(name, brand, gender, image_url, size)").single();
    if (error) failed.push(g.name + " (" + errText(error) + ")"); else { added.push(g.name); S.offers.push(data); }
  }
  const reqRows = IMP.sendReq === false ? [] : IMP.rows.filter((x) => !x.pick && (x.status === "none" || x.dropped))
    .map((x) => ({ store_id: S.store.id, perfume_name: x.name.slice(0, 120), brand: "", size: x.size, price: x.price, note: "من الاستيراد: " + x.raw.slice(0, 400) }));
  let reqs = 0;
  if (reqRows.length) { const r = await sb.from("requests").insert(reqRows).select("*"); if (r.error) failed.push("الطلبات (" + errText(r.error) + ")"); else { reqs = r.data.length; S.requests.unshift(...r.data); } }
  IMP.result = { added, failed, reqs, unpriced }; IMP.step = "done";
  if (added.length) askPublish();
  render();
}
function drawImportDone(el) {
  const r = IMP.result || { added: [], failed: [], reqs: 0 };
  el.innerHTML = `<div class="p-imp p-imp-done">
    <h2>${r.added.length ? `تمت إضافة ${fmt(r.added.length)} عطر إلى كتالوگك ✓` : "لم تتم إضافة أي عطر"}</h2>
    ${r.reqs ? `<p>تم إرسال ${fmt(r.reqs)} طلبات لعطور جديدة. سنضيفها إلى الكتالوگ ونخبرك.</p>` : ""}
    ${r.unpriced ? `<p class="p-imp-note">${fmt(r.unpriced)} عطر بدون ثمن. تظهر في الكويز، وسؤال الميزانية يظهر للزبناء فقط حين يكون لـ 80% من عطورك ثمن.</p>` : ""}
    ${r.failed.length ? `<p class="p-imp-warn">لم تتم إضافة: ${r.failed.map(esc).join("، ")}</p>` : ""}
    <p class="p-small">تظهر العطور الجديدة للزبناء في الكويز خلال 10 إلى 15 دقيقة.</p>
    <div class="p-imp-acts"><button type="button" class="d-btn" id="imp-mine">عرض عطوري</button><button type="button" class="p-link" id="imp-again">استيراد لائحة أخرى</button></div></div>`;
  el.querySelector("#imp-mine").addEventListener("click", () => { IMP.step = "input"; IMP.text = ""; S.tab = "offers"; render(); });
  el.querySelector("#imp-again").addEventListener("click", () => { IMP.step = "input"; IMP.text = ""; tabImport(); });
}

// ───────────── the store's opinion (014): two quick questions, never the whole catalogue ─────────────
const RV_SALES = [[3, "يُباع كثيراً"], [2, "عادي"], [1, "قليل"], [0, "لست متأكداً"]];
const RV_LONG = [[1, "ضعيف"], [2, "متوسط"], [3, "قوي"], [4, "قوي جداً"], [0, "لست متأكداً"]];
const pctOf = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const rvLabel = (list, v) => (list.find(([k]) => k === v) || [])[1] || "";
function reviewForm(p) {
  const id = esc(p.perfume_id), group = (name, legend, list, cur) => `<fieldset class="p-rv-q"><legend>${legend}</legend><div class="p-rv-opts">
    ${list.map(([v, l]) => `<label class="p-rv-opt"><input type="radio" name="${name}-${id}" value="${v}"${cur === v ? " checked" : ""}><span>${l}</span></label>`).join("")}</div></fieldset>`;
  return `<div class="p-rv" data-pid="${id}">
    <div class="p-rv-head">${thumb({ image_url: p.image })}<div><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)}</small>
      ${p.shown ? `<small class="p-rv-seen">ظهر لزبنائك ${fmt(p.shown)} مرة خلال 30 يوماً${p.whatsapp ? ` · ${fmt(p.whatsapp)} نقرة واتساب` : ""}</small>` : ""}</div></div>
    ${group("sales", "كيف يُباع عندك؟", RV_SALES, p.sales)}
    ${group("long", "الثبات حسب زبنائك؟", RV_LONG, p.longevity)}
    <div class="p-rv-acts"><button type="button" class="d-btn" data-rv="save"${p.sales == null && p.longevity == null ? " disabled" : ""}>حفظ الرأي</button>
      <button type="button" class="p-link" data-rv="skip">لاحقاً</button></div>
  </div>`;
}
// answers → Supabase; done(saved) once it is stored
function wireReviewForm(box, p, done) {
  const form = box.querySelector(".p-rv"), save = form.querySelector('[data-rv="save"]');
  const val = (n) => { const x = form.querySelector(`input[name="${n}-${CSS.escape(p.perfume_id)}"]:checked`); return x ? Number(x.value) : null; };
  form.addEventListener("change", () => { save.disabled = val("sales") == null && val("long") == null; });
  const send = async (skip) => {
    save.disabled = true;
    const r = await sb.rpc("save_store_review", { p_store: S.store.id, p_perfume: p.perfume_id, p_sales: skip ? null : val("sales"), p_longevity: skip ? null : val("long"), p_skip: !!skip });
    if (r.error || r.data !== true) { toast(r.error ? errText(r.error) : "لم يُحفظ. أعد المحاولة.", true); save.disabled = false; return; }
    done(!skip, { sales: val("sales"), longevity: val("long") });
  };
  save.addEventListener("click", () => send(false));
  form.querySelector('[data-rv="skip"]').addEventListener("click", () => send(true));
}
// the card above the tabs: one perfume at a time, then a thank-you; gone once answered or put off
function drawQueue() {
  const box = document.getElementById("p-rvq");
  if (!box) return;
  const q = S.queue || [];
  if (!q.length) { box.innerHTML = S.queueThanks ? '<section class="d-card p-rvq p-rvq-done"><p>شكراً 🙏 تم حفظ رأيك، ويبقى خاصاً بمتجرك.</p></section>' : ""; return; }
  const p = q[0];
  box.innerHTML = `<section class="d-card p-rvq" aria-labelledby="p-rvq-t">
    <h2 id="p-rvq-t">رأيك في${q.length > 1 ? " عطرين" : " عطر واحد"} <small>يستغرق 10 ثوانٍ</small></h2>
    <p class="p-small">لنعرف عطورك بشكل أفضل. أجب فقط عمّا تعرفه، ولا تطّلع المتاجر الأخرى على رأيك.</p>
    ${reviewForm(p)}</section>`;
  wireReviewForm(box, p, (saved) => {
    S.queue = q.slice(1); if (saved) S.queueThanks = true;
    drawQueue();
    if (S.tab === "reviews") tabReviews();
  });
}
// ⭐ رأي المتجر: how many perfumes have an opinion, the ones customers see most first, edit any of them
async function tabReviews() {
  const el = document.getElementById("tab");
  el.innerHTML = '<p class="d-msg">جارٍ تحميل العطور…</p>';
  const r = await sb.rpc("store_review_list", { p_store: S.store.id });
  if (r.error) { el.innerHTML = `<p class="d-msg">${/store_review_list|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "يعمل هذا القسم بعد تشغيل <span dir=\"ltr\">014_store_reviews.sql</span> في Supabase." : errText(r.error)}</p>`; return; }
  const rows = (r.data || []).sort((a, b) => (b.shown + 3 * b.whatsapp) - (a.shown + 3 * a.whatsapp) || a.name.localeCompare(b.name));
  const old = (x) => x.reviewed_at && (Date.now() - new Date(x.reviewed_at)) > 180 * 864e5;
  const done = rows.filter((x) => x.reviewed_at && !old(x)).length;
  let only = false;
  const draw = () => {
    const list = only ? rows.filter((x) => !x.reviewed_at || old(x)) : rows;
    el.innerHTML = `<div class="p-rv-sum">
        <p><b>${fmt(done)}</b> من <b>${fmt(rows.length)}</b> عطر فيها رأيك</p>
        <span class="p-rv-bar" role="img" aria-label="${pctOf(done, rows.length)}%"><i style="width:${pctOf(done, rows.length)}%"></i></span>
        <p class="p-small">لا داعي لتقييم كل شيء: في كل زيارة نسألك عن عطر أو عطرين، من التي يراها زبناؤك أكثر. رأيك خاص بمتجرك، ولا يغيّر ترتيب الكويز.</p>
        <label class="p-chk"><input type="checkbox" id="rv-only"${only ? " checked" : ""}> فقط التي تحتاج رأيك</label>
      </div>
      <ul class="p-list p-rv-list">${list.length ? list.map((x) => `<li class="p-item p-item-add" data-pid="${esc(x.perfume_id)}">${thumb({ image_url: x.image })}
        <div class="p-name"><b dir="ltr">${esc(x.name)}</b><small><span dir="ltr">${esc(x.brand)}</span>${x.shown ? ` · ظهر ${fmt(x.shown)} مرة` : ""}</small>
          ${x.reviewed_at ? `<small class="p-rv-mine">${[x.sales != null ? "المبيعات: " + rvLabel(RV_SALES, x.sales) : "", x.longevity != null ? "الثبات: " + rvLabel(RV_LONG, x.longevity) : ""].filter(Boolean).join(" · ")}${old(x) ? " · <b>يحتاج تحديثاً</b>" : ""}</small>` : '<small class="p-rv-none">لم تُبدِ رأيك بعد</small>'}</div>
        <span class="p-have"><button type="button" class="p-link" data-rv-edit="${esc(x.perfume_id)}">${x.reviewed_at ? "✏️ تعديل" : "⭐ أبدِ رأيك"}</button></span></li>`).join("") : '<li class="d-empty">كل العطور فيها رأيك. شكراً!</li>'}</ul>`;
    el.querySelector("#rv-only").addEventListener("change", (e) => { only = e.target.checked; draw(); });
    el.querySelectorAll("[data-rv-edit]").forEach((b) => b.addEventListener("click", () => {
      const x = rows.find((y) => y.perfume_id === b.dataset.rvEdit), li = b.closest("li");
      const holder = document.createElement("li"); holder.className = "p-rv-edit"; holder.innerHTML = reviewForm(x);
      li.after(holder); b.disabled = true;
      wireReviewForm(holder, x, (saved, v) => {
        if (saved) { if (v.sales != null) x.sales = v.sales; if (v.longevity != null) x.longevity = v.longevity; x.reviewed_at = new Date().toISOString(); toast("تم حفظ رأيك ✓"); }
        S.queue = (S.queue || []).filter((y) => y.perfume_id !== x.perfume_id); drawQueue();
        draw();
      });
    }));
  };
  draw();
}

// statistics and monthly report, inside the store space (same numbers as /dashboard/, read with the login)
const statsError = (d) => d.error === "login" ? "سجّل الخروج ثم ادخل من جديد." : d.error === "month" ? "لا توجد أرقام لهذا الشهر." : "تعذّر تحميل الأرقام الآن. أعد المحاولة بعد قليل.";
async function tabStats() {
  const el = document.getElementById("tab");
  const range = `<div class="dh-range p-range" role="group" aria-label="المدة">${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" aria-pressed="${(S.statDays || 30) === d}">${d === 7 ? "7 أيام" : d + " يوم"}</button>`).join("")}</div>`;
  el.innerHTML = range + '<div id="p-stats" aria-live="polite"><p class="d-msg">جارٍ تحميل الإحصائيات…</p></div>';
  el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.statDays = Number(b.dataset.days); tabStats(); }));
  const box = document.getElementById("p-stats");
  let d; try { d = await fetchStats({ days: S.statDays || 30 }); } catch (e) { d = { error: "net" }; }
  if (S.tab !== "stats" || !document.getElementById("p-stats")) return;   // the merchant moved to another tab meanwhile
  if (d.error) { box.innerHTML = `<p class="d-msg">${statsError(d)}</p>`; return; }
  renderDashboard(box, d, { inPortal: true });
}
// 📊 الأرقام › «ما لم يجدوه»: what the store's customers asked for in the quiz without finding a perfume that fits
// well among its perfumes (store_missed, 018). Answers only, no personal data.
const M_GENDER = { women: "نسائي", men: "رجالي", unisex: "للجميع" };
const M_OCC = { daily: "العمل / يومي", evening: "السهرات", dates: "الأمسيات الخاصة", travel: "السفر والخروج", allday: "كل المناسبات" };
const M_SEASON = { summer: "ربيع / صيف", winter: "خريف / شتاء", allseasons: "طول العام" };
const mBudget = (b) => { const c = /^c(\d+)$/.exec(b || ""); if (c) return `حتى ${fmt(c[1])} درهم`;
  return { low: "ميزانية صغيرة", mid: "ميزانية متوسطة", high: "ميزانية مرتفعة", luxury: "ميزانية فاخرة" }[b] || ""; };
async function loadMissed(days) {
  let r; try { r = await sb.rpc("store_missed", { p_store: S.store.id, p_days: days }); } catch (e) { return { error: "net" }; }
  if (r.error) return { error: /store_missed|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "sql" : "net" };
  return r.data || { error: "net" };
}
async function tabMissed() {
  const el = document.getElementById("tab"), days = S.missDays || 30;
  const range = `<div class="dh-range p-range" role="group" aria-label="المدة">${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" aria-pressed="${days === d}">${d === 7 ? "7 أيام" : d + " يوماً"}</button>`).join("")}</div>`;
  el.innerHTML = range + '<div id="p-missed" aria-live="polite"><p class="d-msg">جارٍ تحميل الطلبات…</p></div>';
  el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.missDays = Number(b.dataset.days); tabMissed(); }));
  const d = await loadMissed(days), box = document.getElementById("p-missed");
  if (S.tab !== "missed" || !box) return;
  if (d.error) { box.innerHTML = `<p class="d-msg">${d.error === "sql" ? "هذا القسم يعمل بعد تشغيل 018_store_missed.sql في Supabase." : d.error === "invalid" ? "سجّل الخروج ثم ادخل من جديد." : "تعذّر تحميل الطلبات الآن. أعد المحاولة بعد قليل."}</p>`; return; }
  const req = d.requests || [], top = Object.entries(d.budget || {}).sort((a, b) => b[1] - a[1])[0];
  box.innerHTML = `
    <section class="d-card p-miss-sum">
      <p class="p-miss-big"><b>${fmt(d.missed)}</b> ${d.missed === 1 ? "زبون" : "زبائن"}</p>
      <p>في آخر ${d.days} ${d.days === 7 ? "أيام" : "يوماً"}، لم يجدوا في عطورك عطراً يناسب ما طلبوه في الكويز بشكل كافٍ${d.completed ? `، من أصل ${fmt(d.completed)} أكملوا الكويز` : ""}.</p>
      ${top ? `<p class="p-small">الميزانية الأكثر طلباً عندهم: <b>${esc(mBudget(top[0]) || top[0])}</b> (${fmt(top[1])})</p>` : ""}
    </section>
    ${req.length ? `<h2 class="p-sec-h">الطلبات الأكثر تكراراً</h2>
    <ol class="p-miss-list">${req.map((x) => {
      const bits = [M_OCC[x.occasion], IMP_LABEL[x.impression], M_SEASON[x.season], mBudget(x.budget)].filter(Boolean);
      return `<li class="d-card">
        <div class="p-miss-head"><h3>${esc(M_GENDER[x.gender] || "")}${x.gender ? " · " : ""}${esc(FAM_LABEL[x.family] || x.family)}</h3><span class="p-miss-n">${fmt(x.n)} ${x.n === 1 ? "زبون" : "زبائن"}</span></div>
        ${bits.length ? `<p class="p-miss-bits">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</p>` : ""}
        <p class="p-miss-have ${x.have ? "" : "is-none"}">${x.have ? `عندك ${fmt(x.have)} ${x.have === 1 ? "عطر متوفر" : "عطور متوفرة"} من هذا النوع، ${x.have === 1 ? "لكنه لم يطابق" : "لكنها لم تطابق"} باقي الطلب.` : "ليس عندك أي عطر متوفر من هذا النوع."}</p>
      </li>`; }).join("")}</ol>
    <div class="p-miss-act"><button type="button" class="d-btn" id="b-miss-add">+ أضف عطوراً</button><span class="p-small">كل عطر تضيفه يدخل في الكويز، فيجد زبناء مثل هؤلاء نتائج أقرب لما يطلبون.</span></div>`
    : `<p class="d-empty">${d.completed ? "كل من أكمل الكويز وجد عطراً مناسباً في عطورك 👍" : "تظهر هنا الطلبات عندما يبدأ الزبناء في اجتياز الكويز."}</p>`}
    <p class="d-foot">الأرقام من أجوبة الكويز فقط، والزبون يُحسب مرة واحدة.</p>`;
  const add = document.getElementById("b-miss-add");
  if (add) add.addEventListener("click", () => { S.tab = "offers"; S.addMenu = true; render(); scrollTo(0, 0); });
}

async function tabReport(month) {
  const el = document.getElementById("tab");
  const m = month || S.reportMonth || defaultMonth();
  el.innerHTML = `<div class="r-tools p-rtools"><label class="r-month"><span class="sr">الشهر</span><select id="p-month" aria-label="الشهر"><option>${esc(monthName(m))}</option></select></label>
      <button type="button" class="d-btn" id="p-pdf">تحميل PDF</button></div>
    <div id="p-report" aria-live="polite"><p class="d-msg">جارٍ إعداد التقرير…</p></div>`;
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
      <h2 id="p-link-title">🔗 رابط متجرك</h2>
      <p class="p-small">ضعه في البيو على Instagram، أو أرسله للزبناء عبر الواتساب، أو أضفه إلى موقعك.</p>
      <div class="p-linkrow"><input readonly dir="ltr" value="${esc(url)}" aria-label="رابط متجرك" id="p-store-url">
        <button type="button" class="d-btn" id="b-copy-link">نسخ</button></div>
      <div class="p-review p-linkacts">
        <a class="p-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("جرّب اختبار العطور عندنا واكتشف العطر الذي يناسبك: " + url)}">أرسله عبر الواتساب</a>
        <a class="p-link" target="_blank" rel="noopener" href="${esc(url)}#quiz">جرّب الكويز</a>
      </div>
      ${embedBox(s)}
    </div>
    <div class="p-qr"><canvas id="p-qr" width="132" height="132" aria-label="QR Code الخاص بمتجرك"></canvas>
      <a class="p-link" id="b-qr-dl" download="qr-${esc(s.id)}.png" href="#">تحميل الـ QR</a>
      <small>اطبعه وضعه في المحل</small></div>
  </section>`;
}
// the quiz on the store's own website: a button that opens it, or the quiz inside a page (iframe that sizes itself)
const THEME_ACCENT = { luxury: "#5B2A86", oriental: "#7A2331", modern: "#1F1F22", natural: "#3E6B4A" };
function embedCodes(s) {
  const base = storeLink(s), color = /^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : (THEME_ACCENT[s.theme] || THEME_ACCENT.luxury);
  const button = `<a href="${base}&source=website#quiz" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;border-radius:999px;background:${color};color:#fff;font-weight:700;text-decoration:none">✨ اكتشف العطر الذي يناسبك</a>`;
  const frame = `<iframe id="ff-quiz" src="${base}&embed=1&source=website#quiz" title="اختبار العطور" loading="lazy" allow="clipboard-write; web-share" style="display:block;width:100%;height:1100px;border:0"></iframe>
<script>(function(){var f=document.getElementById("ff-quiz"),o="${location.origin}";addEventListener("message",function(e){var d=e.data;if(e.origin!==o||!d||!d.ff||e.source!==f.contentWindow)return;if(d.type==="height")f.style.height=d.h+"px";if(d.type==="view"){var t=f.getBoundingClientRect().top+d.y;if(d.force||t<0)scrollTo({top:scrollY+t-12,behavior:"smooth"})}})})();</script>`;
  return { button, frame };
}
function embedBox(s) {
  const c = embedCodes(s);
  return `<details class="p-embed">
    <summary>متقدم: 🌐 أضف الكويز إلى موقعك</summary>
    <div class="p-embed-in">
      <h3>1. زر يفتح الكويز</h3>
      <p class="p-small">الأسهل: زر في الصفحة الرئيسية أو في القائمة، يفتح كويز متجرك.</p>
      <textarea readonly dir="ltr" rows="3" aria-label="كود الزر" id="p-code-btn">${esc(c.button)}</textarea>
      <button type="button" class="d-btn ghost" data-copy="p-code-btn">نسخ كود الزر</button>
      <h3>2. الكويز داخل الصفحة</h3>
      <p class="p-small">يجتاز الزبون الكويز دون مغادرة موقعك. يتغيّر الطول تلقائياً حسب كل سؤال.</p>
      <textarea readonly dir="ltr" rows="5" aria-label="كود الكويز داخل الصفحة" id="p-code-frame">${esc(c.frame)}</textarea>
      <button type="button" class="d-btn ghost" data-copy="p-code-frame">نسخ كود الكويز</button>
      <h3>أين ألصق الكود؟</h3>
      <ul class="p-small p-embed-steps">
        <li><b>Shopify:</b> <span class="p-path" dir="ltr">Online Store › Themes › Customize › Add section › Custom Liquid</span>، ألصق الكود ثم اضغط Save.</li>
        <li><b>WordPress / WooCommerce:</b> عدّل الصفحة، أضف بلوك <span class="p-path" dir="ltr">Custom HTML</span>، ألصق الكود ثم اضغط Update.</li>
        <li><b>Wix:</b> استعمل كود الزر (1) في <span class="p-path" dir="ltr">Add › Embed Code › Embed HTML</span>.</li>
        <li><b>موقع خاص:</b> أعطِ الكود لمطوّر موقعك ليضعه حيث تريد.</li>
      </ul>
      <p class="p-small">تظهر الزيارات القادمة من موقعك في الإحصائيات تلقائياً (المصدر: موقعك).</p>
    </div>
  </details>`;
}
function wireLinkCard(s) {
  document.querySelectorAll(".p-embed [data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
    const ta = document.getElementById(btn.dataset.copy), label = btn.textContent;
    try { await navigator.clipboard.writeText(ta.value); btn.textContent = "تم النسخ ✓"; }
    catch (e) { ta.select(); btn.textContent = "حدّد وانسخ"; }
    setTimeout(() => { btn.textContent = label; }, 2500);
  }));
  const b = document.getElementById("b-copy-link"), inp = document.getElementById("p-store-url");
  if (b) b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(inp.value); b.textContent = "تم النسخ ✓"; }
    catch (e) { inp.select(); b.textContent = "حدّد وانسخ"; }
    setTimeout(() => { b.textContent = "نسخ"; }, 2500);
  });
  if (inp) inp.addEventListener("focus", () => inp.select());
  // sharing or trying from here also ticks the home page's first steps
  if (b) b.addEventListener("click", () => onbSet("shared"));
  document.querySelectorAll(".p-linkacts a, #b-qr-dl").forEach((a) => a.addEventListener("click", () => onbSet(/#quiz$/.test(a.getAttribute("href") || "") ? "tried" : "shared")));
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
  }).catch(() => { canvas.replaceWith(Object.assign(document.createElement("small"), { textContent: "تعذّر إنشاء الـ QR الآن." })); });
}

// the RihaFlow team's own space: overview of every store, accounts, requests
function openStore(id, tab) {
  S.store = S.stores.find((x) => x.id === id); if (!S.store) return;
  S.mode = "store"; S.tab = tab || "home"; sessionStorage.setItem("ff_mode", "store");
  loadStore();
}
// the RihaFlow team's space in four sections, like the store space:
// 🏠 الرئيسية (alerts, platform numbers) · 🏪 المتاجر (stores, accounts, new store, subscriptions) · 🧴 الكاتالوگ (perfumes, requests)
// · 👥 الفريق (members and activity log, admin only). An agent sees the first three (016_team_roles.sql).
const isBoss = () => S.role !== "agent";
const T_SECTIONS = () => [["home", ICON.home, "الرئيسية"], ["stores", ICON.store, "المتاجر"], ["catalog", ICON.perfumes, "الكاتالوگ"]].concat(isBoss() ? [["team", ICON.team, "الفريق"]] : []);
const T_SEC = { overview: "home", stores: "stores", accounts: "stores", newacc: "stores", subs: "stores", perfumes: "catalog", review: "catalog", members: "team", log: "team" };
const T_FIRST = { home: "overview", stores: "stores", catalog: "perfumes", team: "members" };
function renderTeam() {
  if (!T_SEC[S.teamTab] || (T_SEC[S.teamTab] === "team" && !isBoss()) || (S.teamTab === "subs" && !isBoss())) S.teamTab = "overview";
  const sec = T_SEC[S.teamTab];
  const seg = (items) => `<nav class="p-seg" aria-label="${T_SECTIONS().find((x) => x[0] === sec)[2]}">${items.map(([k, l]) => `<button type="button" data-team="${k}" aria-pressed="${S.teamTab === k}">${l}</button>`).join("")}</nav>`;
  const sub = {
    stores: seg([["stores", `المتاجر <small>${S.stores.length}</small>`], ["accounts", "الحسابات"], ["newacc", "+ متجر جديد"]].concat(isBoss() ? [["subs", "الاشتراكات"]] : [])),
    catalog: seg([["perfumes", "العطور"], ["review", 'الطلبات <small id="t-req-n" hidden></small>']]),
    team: seg([["members", "الأعضاء"], ["log", "سجل النشاط"]]),
  }[sec] || "";
  app.innerHTML = `
    <section class="d-head p-head"><span class="d-seal p-seal-team" aria-hidden="true">R</span>
      <div><p class="p-hello">${greeting()}</p><h1>فريق RihaFlow</h1></div>
      <span class="p-chip ${S.role === "agent" ? "is-agent" : "is-admin"}"><i></i>${S.role === "agent" ? "Agent" : "Admin"}</span>
      <button type="button" class="d-btn p-publish" id="b-publish">🚀 انشر الموقع الآن</button></section>
    <nav class="p-nav" aria-label="الأقسام">${T_SECTIONS().map(([k, i, l]) => `<button type="button" data-tsec="${k}"${sec === k ? ' aria-current="page"' : ""}><span class="p-nav-i">${i}</span>${l}</button>`).join("")}</nav>
    ${sub}
    <section id="tab" class="${S.teamTab === "overview" || S.teamTab === "stores" ? "p-overview" : "d-card p-panel"}"></section>`;
  app.querySelectorAll("[data-tsec]").forEach((b) => b.addEventListener("click", () => { S.teamTab = T_FIRST[b.dataset.tsec]; S.q = ""; renderTeam(); scrollTo(0, 0); }));
  app.querySelectorAll("[data-team]").forEach((b) => b.addEventListener("click", () => { S.teamTab = b.dataset.team; S.q = ""; renderTeam(); }));
  document.getElementById("b-publish").addEventListener("click", async (e) => {
    e.target.disabled = true;
    let r; try { r = await teamCall("publish", { now: true }); } catch (er) { r = { error: "net" }; }
    e.target.disabled = false;
    if (r.published) toast("🚀 تم الإرسال. يتحدّث الكويز خلال دقيقة أو دقيقتين.");
    else if (r.queued) toast("تم تسجيل الطلب: هناك نشر قبل قليل، سيُعاد خلال 10 دقائق.");
    else toast("لم يتم النشر. تأكد من Apps Script (New version) ورابط النشر.", true);
  });
  if (sec === "catalog") sb.from("requests").select("id", { count: "exact", head: true }).eq("status", "pending").then((r) => {
    const n = document.getElementById("t-req-n"); if (n && r.count) { n.textContent = r.count; n.hidden = false; }
  });
  ({ overview: tabOverview, stores: tabStores, accounts: () => tabAccounts("list"), newacc: () => tabAccounts("new"), subs: tabSubs,
     perfumes: tabPerfumes, review: tabReview, members: tabMembers, log: tabLog }[S.teamTab] || tabOverview)();
}
const manageCell = (x) => S.stores.some((y) => y.id === x.id)
  ? `<span class="a-acts"><button type="button" class="d-btn a-open" data-manage="${esc(x.id)}">إدارة المتجر</button><button type="button" class="p-link" data-edit="${esc(x.id)}">📁 ملف المتجر</button></span>` : "<small>غير موجود في Supabase</small>";

// 📁 ملف المتجر › notes (team) and payments (admin), 019_payments_notes.sql
const todayISO = () => new Date().toLocaleDateString("en-CA");                       // the browser's day (Morocco)
const addMonth = (iso) => { const d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + 1); return d.toLocaleDateString("en-CA"); };
const PAY_METHOD = { cash: "نقداً", transfer: "تحويل بنكي", card: "بطاقة", other: "أخرى" };
const isMissing = (err) => /store_notes|store_payments|42P01|PGRST205|does not exist/.test((err && (err.message || "")) + (err && err.code));
const need019 = '<p class="d-msg">هذا القسم يعمل بعد تشغيل 019_payments_notes.sql في Supabase.</p>';

async function storeNotes(st) {
  const box = document.getElementById("e-notes");
  if (!box) return;
  box.innerHTML = `<form id="f-note" class="p-form p-note-form" novalidate>
      <label>ملاحظة<textarea name="body" id="n-body" rows="2" maxlength="1000" placeholder="مثال: اتصلت به، سيضيف عطوره يوم الاثنين"></textarea></label>
      <div class="p-edit-row"><label>تذكير يوم (اختياري)<input type="date" name="follow" id="n-follow" dir="ltr"></label>
      <button type="submit" class="d-btn">أضف الملاحظة</button></div></form>
    <ul class="p-notes" id="n-list"><li class="d-empty">جارٍ تحميل الملاحظات…</li></ul>`;
  const f = document.getElementById("f-note");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = f.body.value.trim();
    if (!body) return toast("اكتب الملاحظة.", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const r = await sb.from("store_notes").insert({ store_id: st.id, body, follow_up: f.follow.value || null, author: S.user.id });
    b.disabled = false;
    if (r.error) return toast(isMissing(r.error) ? "شغّل 019_payments_notes.sql في Supabase أولاً." : errText(r.error), true);
    f.reset(); toast("تمت إضافة الملاحظة ✓"); draw();
  });
  async function draw() {
    const ul = document.getElementById("n-list"); if (!ul) return;
    const r = await sb.from("store_notes").select("*").eq("store_id", st.id).order("created_at", { ascending: false }).limit(50);
    if (r.error) { ul.innerHTML = isMissing(r.error) ? `<li>${need019}</li>` : `<li class="d-empty">${errText(r.error)}</li>`; return; }
    const today = todayISO();
    ul.innerHTML = r.data.length ? r.data.map((n) => `<li data-id="${n.id}" class="${n.follow_up && !n.done ? (n.follow_up <= today ? "is-due" : "is-later") : ""}">
        <p dir="auto">${esc(n.body)}</p>
        <small><span dir="ltr">${esc(n.author_email)}</span> · ${dateAr(n.created_at)}${n.follow_up ? ` · ${n.done ? "✓ تمت المتابعة" : "📌 تذكير " + dateAr(n.follow_up)}` : ""}</small>
        <div class="p-review">${n.follow_up && !n.done ? '<button type="button" class="p-link" data-done>تم ✓</button>' : ""}
          ${isBoss() || n.author === S.user.id ? '<button type="button" class="p-link p-danger" data-del>حذف</button>' : ""}</div></li>`).join("")
      : '<li class="d-empty">لا توجد ملاحظات بعد.</li>';
    ul.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => {
      const x = await sb.from("store_notes").update({ done: true }).eq("id", b.closest("li").dataset.id);
      if (x.error) return toast(errText(x.error), true);
      toast("تمت المتابعة ✓"); draw();
    }));
    ul.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "متأكد؟"; return; }
      const x = await sb.from("store_notes").delete().eq("id", b.closest("li").dataset.id);
      if (x.error) return toast(errText(x.error), true);
      toast("تم الحذف ✓"); draw();
    }));
  }
  draw();
}

async function storePayments(st) {
  const box = document.getElementById("e-pays");
  if (!box) return;
  const r = await sb.from("store_payments").select("*").eq("store_id", st.id).order("paid_at", { ascending: false }).limit(60);
  if (!document.body.contains(box)) return;
  if (r.error) { box.innerHTML = isMissing(r.error) ? need019 : `<p class="d-msg">${errText(r.error)}</p>`; return; }
  const pays = r.data, today = todayISO();
  const until = pays.reduce((m, p) => (p.paid_until > m ? p.paid_until : m), "");
  const from = until && until >= today ? until : today;
  const late = until && until < today && st.subscription_status === "active";
  box.innerHTML = `<p class="p-pay-state ${!until ? "" : late ? "is-late" : until >= today ? "is-ok" : ""}">${!until ? "لا يوجد أي أداء مسجل." : late ? `⚠️ متأخر: آخر أداء يغطي حتى ${dateAr(until)}.` : `مؤدى حتى ${dateAr(until)}.`}</p>
    <form id="f-pay" class="p-form" novalidate>
      <div class="p-grid2"><label>المبلغ (درهم)<input type="number" name="amount" id="y-amount" min="1" step="1" value="299" inputmode="numeric" dir="ltr"></label>
        <label>الطريقة<select name="method" id="y-method">${Object.entries(PAY_METHOD).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label>تاريخ الأداء<input type="date" name="paid_at" id="y-at" value="${today}" dir="ltr"></label>
        <label>مؤدى حتى<input type="date" name="paid_until" id="y-until" value="${addMonth(from)}" dir="ltr"></label></div>
      <label>ملاحظة (اختياري)<input name="note" id="y-note" maxlength="300"></label>
      ${st.subscription_status !== "active" ? `<label class="p-check"><input type="checkbox" name="activate" id="y-act" checked> فعّل الاشتراك (الآن: ${SUB_LABEL[st.subscription_status] || st.subscription_status})</label>` : ""}
      <button type="submit" class="d-btn">سجّل الأداء</button></form>
    ${pays.length ? `<ul class="p-pays">${pays.map((p) => `<li data-id="${p.id}"><div><b>${fmt(p.amount)} درهم</b><small>${dateAr(p.paid_at)} · ${PAY_METHOD[p.method] || p.method} · حتى ${dateAr(p.paid_until)}${p.note ? " · " + esc(p.note) : ""}</small></div>
      <button type="button" class="p-link p-danger" data-del>حذف</button></li>`).join("")}</ul>` : ""}`;
  const f = document.getElementById("f-pay");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Number(f.amount.value);
    if (!(amount > 0)) return toast("اكتب المبلغ.", true);
    if (!f.paid_at.value || !f.paid_until.value) return toast("اختر التاريخين.", true);
    if (f.paid_until.value < f.paid_at.value) return toast("«مؤدى حتى» يجب أن يكون بعد تاريخ الأداء.", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const x = await sb.from("store_payments").insert({ store_id: st.id, amount, method: f.method.value, paid_at: f.paid_at.value, paid_until: f.paid_until.value, note: f.note.value.trim() });
    if (x.error) { b.disabled = false; return toast(errText(x.error), true); }
    if (f.activate && f.activate.checked) {
      const s2 = await sb.rpc("set_subscription", { p_store: st.id, p_status: "active" });
      if (!s2.error && s2.data && s2.data.ok) { st.subscription_status = "active"; st.trial_ends_at = null; askPublish(); }
      else toast("تم تسجيل الأداء، لكن لم يتم تفعيل الاشتراك. فعّله من «الاشتراكات».", true);
    }
    toast("تم تسجيل الأداء ✓"); storePayments(st);
  });
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "متأكد؟"; return; }
    const x = await sb.from("store_payments").delete().eq("id", b.closest("li").dataset.id);
    if (x.error) return toast(errText(x.error), true);
    toast("تم الحذف ✓"); storePayments(st);
  }));
}

// 🏠 الرئيسية (team): follow-ups due today or earlier, from the stores' notes
async function followUps(el) {
  const r = await sb.from("store_notes").select("*").eq("done", false).lte("follow_up", todayISO()).order("follow_up").limit(30);
  if (r.error || !r.data.length || S.teamTab !== "overview") return;
  const name = (id) => (S.stores.find((x) => x.id === id) || {}).name || id;
  const sec = document.createElement("section");
  sec.className = "d-card p-follow"; sec.setAttribute("aria-labelledby", "p-follow-t");
  sec.innerHTML = `<h2 id="p-follow-t">📌 متابعات اليوم <span class="a-count">${r.data.length}</span></h2>
    <ul>${r.data.map((n) => `<li data-id="${n.id}"><div><b>${esc(name(n.store_id))}</b> <span dir="auto">${esc(n.body)}</span>
      <small><span dir="ltr">${esc(n.author_email)}</span> · ${n.follow_up < todayISO() ? "متأخرة منذ " : "اليوم "}${dateAr(n.follow_up)}</small></div>
      <div class="p-review"><button type="button" class="p-link" data-file="${esc(n.store_id)}">📁 الملف</button><button type="button" class="a-fix" data-done>تم ✓</button></div></li>`).join("")}</ul>`;
  const alerts = el.querySelector(".a-alerts");
  if (alerts) alerts.before(sec); else el.append(sec);
  sec.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => {
    const x = await sb.from("store_notes").update({ done: true }).eq("id", b.closest("li").dataset.id);
    if (x.error) return toast(errText(x.error), true);
    b.closest("li").remove(); toast("تمت المتابعة ✓");
    if (!sec.querySelector("li")) sec.remove();
  }));
  sec.querySelectorAll("[data-file]").forEach((b) => b.addEventListener("click", async () => {
    S.teamTab = "stores"; renderTeam(); scrollTo(0, 0);
    const id = b.dataset.file;
    for (let i = 0; i < 40 && !document.querySelector(`[data-edit="${CSS.escape(id)}"]`); i++) await new Promise((ok) => setTimeout(ok, 150));
    editStore(id);
  }));
}

// 🏪 المتاجر › 📁 ملف المتجر: the store's name (team, rename_store 017) and its account's email (admin, Apps Script changeEmail).
// The store_id stays: the link and the printed QR codes use it.
async function editStore(id) {
  const st = S.stores.find((x) => x.id === id), el = document.getElementById("tab");
  if (!st || !el) return;
  let box = document.getElementById("p-edit");
  if (!box) { box = document.createElement("section"); box.id = "p-edit"; box.className = "d-card p-edit"; el.prepend(box); }
  box.setAttribute("aria-labelledby", "p-edit-t");
  box.innerHTML = `<div class="p-steps-head"><h2 id="p-edit-t">📁 ملف المتجر · ${esc(st.name)}</h2><button type="button" class="p-link" data-close>إغلاق</button></div>
    <p class="p-small">store_id: <code dir="ltr">${esc(st.id)}</code> · لا يتغيّر، حتى يبقى رابط المتجر والـ QR المطبوع يعملان.</p>
    <form id="f-sname" class="p-edit-row" novalidate><label>اسم المتجر<input name="name" id="e-name" maxlength="80" value="${esc(st.name)}" required></label>
      <button type="submit" class="d-btn">حفظ الاسم</button></form>
    <h3 class="p-h3">حساب التاجر</h3>
    <div id="e-accounts">${isBoss() ? '<p class="d-msg">جارٍ تحميل الحساب…</p>' : '<p class="p-small">تغيير البريد الإلكتروني خاص بالـ admin.</p>'}</div>
    <h3 class="p-h3">📝 الملاحظات</h3><div id="e-notes"></div>
    ${isBoss() ? '<h3 class="p-h3">💰 الأداءات</h3><div id="e-pays"><p class="d-msg">جارٍ تحميل الأداءات…</p></div>' : ""}`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  box.querySelector("[data-close]").addEventListener("click", () => box.remove());
  storeNotes(st);
  if (isBoss()) storePayments(st);
  const f = document.getElementById("f-sname");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = f.name.value.trim().replace(/\s+/g, " ");
    if (name.length < 2) return toast("اكتب اسم المتجر.", true);
    if (name === st.name) return toast("الاسم لم يتغيّر.");
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const r = await sb.rpc("rename_store", { p_store: st.id, p_name: name });
    b.disabled = false;
    if (r.error) return toast(/rename_store|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "شغّل 017_store_edit.sql في Supabase أولاً." : errText(r.error), true);
    if (r.data && r.data.error) return toast({ forbidden: "هذا الإجراء خاص بفريق RihaFlow.", name: "يجب أن يتكون الاسم من 2 إلى 80 حرفاً.", store: "المتجر غير موجود." }[r.data.error] || "لم يتم الحفظ.", true);
    st.name = r.data.name; toast("تم حفظ الاسم ✓ يظهر في الكويز بعد النشر."); askPublish();
    await tabStores(); editStore(st.id);
  });
  if (!isBoss()) return;
  const acc = document.getElementById("e-accounts");
  let r; try { r = await teamCall("merchants"); } catch (er) { r = { error: "net" }; }
  if (!document.body.contains(acc)) return;
  if (r.error) { acc.innerHTML = `<p class="d-msg">${esc(r.message || "تعذّر تحميل الحساب.")}</p>`; return; }
  const mine = r.accounts.filter((a) => a.store_id === st.id);
  acc.innerHTML = mine.length ? mine.map((a, i) => `<form class="p-edit-row" data-uid="${esc(a.user_id)}" novalidate>
      <label>البريد الإلكتروني<input type="email" name="email" id="e-mail-${i}" dir="ltr" value="${esc(a.email)}" autocomplete="off"></label>
      <button type="submit" class="d-btn">حفظ البريد</button></form>`).join("") + '<p class="p-small">يبقى التاجر يدخل بنفس كلمة السر، بالبريد الجديد. أخبره بالتغيير.</p>'
    : '<p class="p-small">لا يوجد حساب لهذا المتجر.</p><button type="button" class="d-btn" data-newacc>أنشئ حساباً</button>';
  const na = acc.querySelector("[data-newacc]");
  if (na) na.addEventListener("click", () => { S.teamTab = "newacc"; S.prefill = st.id; renderTeam(); scrollTo(0, 0); });
  acc.querySelectorAll("form").forEach((fm) => fm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = fm.email.value.trim().toLowerCase(), before = mine.find((a) => a.user_id === fm.dataset.uid).email;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("اكتب بريداً إلكترونياً صحيحاً.", true);
    if (email === before.toLowerCase()) return toast("البريد لم يتغيّر.");
    const b = fm.querySelector("[type=submit]");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "متأكد؟ اضغط مرة أخرى"; return; }
    b.disabled = true;
    const r2 = await teamCall("changeEmail", { user_id: fm.dataset.uid, email, store_id: st.id });
    b.disabled = false; b.dataset.sure = ""; b.textContent = "حفظ البريد";
    if (r2.error) return toast(r2.message || "لم يتم التغيير.", true);
    mine.find((a) => a.user_id === fm.dataset.uid).email = r2.email;
    toast("تم تغيير البريد ✓ أخبر التاجر أن يدخل بالبريد الجديد.");
  }));
}
// numbers per store for the chosen period (admin_stats), plus the stores that have none yet
async function adminData() {
  let d = null;
  try { const r = await sb.rpc("admin_stats", { p_days: S.days }); if (!r.error && r.data && Array.isArray(r.data.stores)) d = r.data; } catch (e) {}
  if (!d) return null;
  // a name just changed shows at once; the status says whether customers see the store (subscription, trial, active)
  d.stores.forEach((x) => { const s = S.stores.find((y) => y.id === x.id); if (s) { x.name = s.name; x.state = storeState(s); } });
  const known = new Set(d.stores.map((x) => x.id));
  S.stores.forEach((x) => { if (!known.has(x.id)) d.stores.push({ id: x.id, name: x.name, active: x.active !== false, perfumes: 0, experiences: 0, completed: 0, whatsapp: 0, last: "" }); });
  return d;
}
// 🏪 المتاجر: every store, its activity in the period, and «إدارة المتجر»
async function tabStores() {
  const el = document.getElementById("tab");
  const range = `<div class="p-range dh-range" role="group" aria-label="المدة">${[[1, "اليوم"], [7, "7 أيام"], [30, "30 يوماً"]].map(([d, l]) => `<button type="button" data-days="${d}" aria-pressed="${S.days === d}">${l}</button>`).join("")}</div>`;
  el.innerHTML = range + '<p class="d-msg">جارٍ تحميل المتاجر…</p>';
  const wire = () => el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.days = Number(b.dataset.days); tabStores(); }));
  wire();
  const d = await adminData();
  if (!d) { el.innerHTML = range + '<p class="d-msg">تعذّر تحميل المتاجر من Supabase الآن. أعد المحاولة بعد قليل.</p>'; wire(); return; }
  el.innerHTML = range + storesHTML(d, manageCell);
  wire(); wireStoreSearch(el);
  el.querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openStore(b.dataset.manage)));
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editStore(b.dataset.edit)));
}
// what customers see: [css class, label] from the store's subscription (same rule as store_is_live in Supabase)
function storeState(s) {
  if (s.active === false) return ["off", "موقوف"];
  if (s.subscription_status === "active") return ["on", "مفعّل"];
  if (s.subscription_status === "trial") return s.trial_ends_at && daysLeft(s.trial_ends_at) <= 0 ? ["off", "انتهت التجربة"] : ["trial", "تجربة"];
  return ["off", SUB_LABEL[s.subscription_status] || "لا يظهر"];
}
// each alert takes you to where it is fixed: a store without an account → the new-account form with that store chosen;
// an ended trial → the subscriptions (admin); a store without perfumes → its perfumes with «+ أضف عطوراً» open;
// no activity → the store's link and QR, to send to the merchant
const FIX_LABEL = { token: "أنشئ حساباً", trial: "الاشتراك", catalog: "أضف عطوراً", inactive: "رابط المتجر" };
const alertStore = (a) => S.stores.find((x) => x.name === a.store);
function alertFix(a, i) {
  if (!FIX_LABEL[a.type] || !alertStore(a) || (a.type === "trial" && !isBoss())) return "";
  return `<button type="button" class="a-fix" data-fix="${i}">${FIX_LABEL[a.type]} ←</button>`;
}
function fixAlert(a) {
  const st = a && alertStore(a); if (!st) return;
  if (a.type === "token") { S.teamTab = "newacc"; S.prefill = st.id; renderTeam(); }
  else if (a.type === "trial") { S.teamTab = "subs"; S.prefill = st.id; renderTeam(); }
  else if (a.type === "catalog") { S.addMenu = true; openStore(st.id, "offers"); }
  else if (a.type === "inactive") openStore(st.id, "settings");
  scrollTo(0, 0);
}
async function tabOverview() {
  const el = document.getElementById("tab");
  const range = `<div class="p-range dh-range" role="group" aria-label="المدة">${[[1, "اليوم"], [7, "7 أيام"], [30, "30 يوماً"]].map(([d, l]) => `<button type="button" data-days="${d}" aria-pressed="${S.days === d}">${l}</button>`).join("")}</div>`;
  el.innerHTML = range + '<p class="d-msg">جارٍ تحميل الأرقام…</p>';
  const wire = () => el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { S.days = Number(b.dataset.days); tabOverview(); }));
  wire();
  // from Supabase (the Sheet's numbers are not used any more)
  let d = null;
  try { const r = await sb.rpc("admin_stats", { p_days: S.days }); if (!r.error && r.data && Array.isArray(r.data.stores)) d = r.data; } catch (e) {}
  if (!d) d = { error: "net" };
  if (d.error) { el.innerHTML = range + '<p class="d-msg">تعذّر تحميل الأرقام من Supabase الآن. أعد المحاولة بعد قليل.</p>'; wire(); return; }
  // stores that exist in Supabase but have no numbers yet still appear, so every store can be opened from here
  const known = new Set(d.stores.map((x) => x.id));
  S.stores.forEach((x) => { if (!known.has(x.id)) d.stores.push({ id: x.id, name: x.name, active: x.active !== false, perfumes: 0, experiences: 0, completed: 0, whatsapp: 0, last: "" }); });
  // a store the team stopped on purpose (cancelled, paused, switched off) raises no alerts: it is not expected to work
  const stopped = (a) => { const st = alertStore(a); return !!st && (st.active === false || ["cancelled", "paused"].includes(st.subscription_status)); };
  d.alerts = (d.alerts || []).filter((a) => !stopped(a));
  el.innerHTML = range + adminHTML({ ...d, title: "اللوحة العامة" }, manageCell, "الأرقام والمتاجر والحسابات من Supabase.", { stores: false, fix: alertFix });
  wire();
  el.querySelectorAll("[data-fix]").forEach((b) => b.addEventListener("click", () => fixAlert(d.alerts[Number(b.dataset.fix)])));
  followUps(el);
  // platform numbers (013_admin_insights.sql), under the alerts; nothing shown when the function is not there yet
  const days = S.days;
  try {
    const r = await sb.rpc("admin_insights", { p_days: days });
    const alerts = el.querySelector(".a-alerts");
    if (!r.error && r.data && !r.data.error && alerts && S.days === days && S.teamTab === "overview") {
      const box = document.createElement("div"); box.className = "a-insights"; box.innerHTML = insightsHTML(r.data, { revenue: isBoss() });
      alerts.after(box);
    }
  } catch (e) {}
  quizSteps(el, days);
}

// 🏠 (team) «أين يتوقف الزبناء؟»: visits that opened the page, answered each question, finished (quiz_steps, 022)
const STEP_LABEL = { gender: "لمن العطر", occasion: "المناسبة", season: "الموسم", character: "العائلة العطرية", impression: "الانطباع",
  world: "نوع العطور", sizeType: "قنينة أو ديكونط", budget: "الميزانية" };
async function quizSteps(el, days, store) {
  let r; try { r = await sb.rpc("quiz_steps", { p_days: days, p_store: store || null }); } catch (e) { return; }
  if (r.error || !r.data || r.data.error || S.teamTab !== "overview" || S.days !== days) return;
  const d = r.data;
  let sec = document.getElementById("p-steps-funnel");
  if (!sec) { sec = document.createElement("section"); sec.id = "p-steps-funnel"; sec.className = "d-card p-sfun"; sec.setAttribute("aria-labelledby", "p-sfun-t"); el.append(sec); }
  const pick = `<label class="p-sfun-pick"><span class="sr">المتجر</span><select id="sfun-store"><option value="">جميع المتاجر</option>${S.stores.map((x) => `<option value="${esc(x.id)}"${x.id === store ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>`;
  const head = `<div class="p-steps-head"><h2 id="p-sfun-t">أين يتوقف الزبناء؟</h2>${pick}</div>`;
  if (!d.tracking) {
    sec.innerHTML = head + '<p class="d-empty">يبدأ الحساب مع أول زبون يجيب عن سؤال بعد هذا التحديث.</p>';
  } else {
    const rows = [["زاروا الصفحة", d.opened]].concat((d.steps || []).map((s) => [`أجابوا: ${STEP_LABEL[s.q] || s.q}`, s.n])).concat([["أكملوا الكويز", d.completed]]);
    const top = Math.max(1, rows[0][1], ...rows.map((x) => x[1]));
    let worst = -1, worstDrop = 0;
    // the biggest stop is the biggest share lost from one step to the next
    rows.forEach((x, i) => { if (i && rows[i - 1][1]) { const drop = (rows[i - 1][1] - x[1]) / rows[i - 1][1]; if (drop > worstDrop) { worstDrop = drop; worst = i; } } });
    sec.innerHTML = head + `<ol class="p-sfun-list">${rows.map(([l, n], i) => {
      const lost = i ? rows[i - 1][1] - n : 0;
      return `<li class="${i === worst && worstDrop > 0 ? "is-worst" : ""}"><div class="p-sfun-row"><span>${esc(l)}</span><b>${fmt(n)}</b></div>
        <span class="p-sfun-bar"><i style="width:${Math.max(2, (n / top) * 100)}%"></i></span>
        ${i && lost > 0 ? `<small>${i === worst ? "أكبر توقف: " : ""}توقف ${fmt(lost)} (${Math.round((lost / Math.max(1, rows[i - 1][1])) * 100)}%)</small>` : ""}</li>`; }).join("")}</ol>
      <p class="p-small">زيارات منذ ${dateAr(d.since)}. الزائر يُحسب مرة واحدة في كل خطوة.</p>`;
  }
  const sel = document.getElementById("sfun-store");
  if (sel) sel.addEventListener("change", () => quizSteps(el, days, sel.value));
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
  const noPrice = (o) => !(Number(o.price) > 0) && !vlist(o).some((v) => Number(v.price) > 0);
  const FILTERS = [["all", "الكل", () => true], ["in", "متوفر", (o) => o.active && o.in_stock], ["out", "غير متوفر", (o) => o.active && !o.in_stock], ["noprice", "بدون ثمن", (o) => o.active && noPrice(o)]];
  const pass = () => (FILTERS.find((x) => x[0] === (S.of || "all")) || FILTERS[0])[2];
  el.innerHTML = `${search("ابحث بالاسم أو الماركة…")}
    <div class="p-filters" role="group" aria-label="تصفية">${FILTERS.map(([k, l, fn]) => `<button type="button" data-of="${k}" class="${k === "noprice" ? "is-gold" : ""}" aria-pressed="${(S.of || "all") === k}">${l} <small>${S.offers.filter(fn).length}</small></button>`).join("")}</div>
    <ul class="p-list" id="list"></ul>`;
  el.querySelectorAll("[data-of]").forEach((b) => b.addEventListener("click", () => {
    S.of = b.dataset.of; el.querySelectorAll("[data-of]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw();
  }));
  const draw = () => {
    const list = S.offers.filter((o) => pass()(o) && match(o.perfumes || { name: o.perfume_id, brand: "" }, S.q));
    const ul = document.getElementById("list");
    if (!S.offers.length) { ul.innerHTML = '<li class="d-empty">لا توجد عطور بعد. أضف من «أضف عطراً».</li>'; return; }
    if (!list.length) { ul.innerHTML = `<li class="d-empty">${S.q ? "لا توجد نتائج بهذا الاسم." : "لا توجد عطور هنا."}</li>`; return; }
    ul.innerHTML = list.map((o, i) => `<li class="p-item${o.active ? "" : " is-removed"}${o.in_stock ? "" : " is-out"}${o.active && noPrice(o) ? " is-noprice" : ""}" data-id="${o.id}">
      ${thumb(o.perfumes).replace('class="p-bottle"', `class="p-bottle b${i % 5}"`)}
      <div class="p-name"><b dir="ltr">${esc(o.perfumes?.name || o.perfume_id)}</b><small dir="ltr">${esc(o.perfumes?.brand || "")}${o.size ? " · " + esc(o.size) : ""}</small>
        ${o.active ? `<button type="button" class="p-link p-sizes-btn" data-act="sizes">📏 الأحجام والأثمنة${vlist(o).length > 1 ? ` (${vlist(o).length})` : ""}</button>` : ""}</div>
      ${o.active ? `${vlist(o).length > 1 ? `<span class="p-from">من ${fmt(o.price)} <em>درهم</em><small>${vlist(o).length} أحجام</small></span>`
        : `<label class="p-price"><span class="sr">الثمن</span><input type="number" inputmode="decimal" min="0" step="1" value="${o.price ?? ""}" data-act="price"><em>درهم</em></label>`}
        <label class="p-switch"><input type="checkbox" data-act="stock"${o.in_stock ? " checked" : ""}><span>${o.in_stock ? "متوفر" : "غير متوفر"}</span></label>
        <button type="button" class="p-icon" data-act="remove" aria-label="إزالة ${esc(o.perfumes?.name || "")}" title="إزالة">✕</button>`
      : `<span class="p-tag">مُزال</span><button type="button" class="p-link" data-act="restore">إرجاع</button>`}
    </li>`).join("");
  };
  draw(); wireSearch(draw);
  el.addEventListener("change", async (e) => {
    if (e.target.closest(".p-sizes")) return;
    const li = e.target.closest(".p-item"); if (!li) return;
    const o = S.offers.find((x) => x.id === Number(li.dataset.id));
    if (e.target.dataset.act === "price") {
      const v = e.target.value === "" ? null : Number(e.target.value);
      if (v != null && (isNaN(v) || v < 0 || v > 100000)) { toast("الثمن غير صحيح.", true); e.target.value = o.price ?? ""; return; }
      // one size saved as a size: change its price there, so price and sizes stay the same thing
      const vs = vlist(o);
      if (vs.length === 1 && v) await save(o, { variants: [{ ...vs[0], price: v }] }, "تم تغيير الثمن ✓");
      else await save(o, { price: v }, "تم تغيير الثمن ✓");
    }
    if (e.target.dataset.act === "stock") { await save(o, { in_stock: e.target.checked }, e.target.checked ? "أصبح متوفراً ✓" : "أصبح غير متوفر ✓"); render(); }
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
    await save(o, { active: act === "restore" }, act === "restore" ? "تم إرجاع العطر ✓" : "تمت إزالة العطر. يمكنك إرجاعه لاحقاً.");
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
      <button type="button" class="p-link" data-k="add">+ أضف حجماً آخر</button></div></div>`;
}
function customRow(v = {}) {
  return `<div class="p-size" role="group">
    <label><span class="sr">النوع</span><select data-k="type">${Object.keys(TYPE).map((t) => `<option value="${t}"${(v.type || "decant") === t ? " selected" : ""}>${TYPE[t]}</option>`).join("")}</select></label>
    <label><span class="sr">الحجم</span><input data-k="size" maxlength="20" dir="ltr" placeholder="15ml" value="${esc(v.size || "")}"></label>
    <label class="p-price"><span class="sr">الثمن</span><input data-k="price" type="number" inputmode="decimal" min="0" step="1" placeholder="الثمن" value="${v.price ?? ""}"><em>درهم</em></label>
    <button type="button" class="p-icon" data-k="del" aria-label="احذف هذا الحجم">✕</button></div>`;
}
// read the ticked sizes; null (with a message) when something is missing
function readPicker(box) {
  const out = [], seen = new Set();
  const push = (type, size, pv) => {
    size = normSize(size); const price = Number(pv);
    if (!size) { toast("اكتب الحجم (مثلاً 15ml).", true); return false; }
    if (pv === "" || !(price > 0) || price > 100000) { toast(`اكتب ثمن ${size}.`, true); return false; }
    const key = type + "|" + size.toLowerCase();
    if (seen.has(key)) { toast(`${size} مكتوب مرتين.`, true); return false; }
    seen.add(key); out.push({ type, size, price }); return true;
  };
  for (const c of box.querySelectorAll(".p-chkrow input[type=checkbox]:checked"))
    if (!push(c.dataset.type, c.dataset.size, c.closest(".p-chkrow").querySelector("input[type=number]").value)) return null;
  for (const r of box.querySelectorAll(".p-size")) {
    const size = r.querySelector("[data-k=size]").value, pv = r.querySelector("[data-k=price]").value;
    if (!size.trim() && !pv) continue;
    if (!push(r.querySelector("[data-k=type]").value, size, pv)) return null;
  }
  if (!out.length) { toast("اختر حجماً واحداً على الأقل واكتب ثمنه.", true); return null; }
  if (out.length > 12) { toast("الحد الأقصى 12 حجماً.", true); return null; }
  return out;
}
// opens the checklist under a list item; onSave(variants) returns true when saved
function openPicker(li, variants, bottleSize, label, onSave) {
  li.parentElement.querySelectorAll(".p-sizes-row").forEach((x) => x.remove());
  const box = document.createElement("li");
  box.className = "p-sizes-row";
  box.innerHTML = `<div class="p-sizes">
    <p class="p-small">حدّد الأحجام التي تبيعها واكتب ثمن كل واحد.</p>
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
    const ok = await save(o, { variants: out }, `تم الحفظ ${out.length} ${out.length === 1 ? "حجم" : "أحجام"} ✓`);
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

// add a perfume from the RihaFlow catalogue
async function tabAdd() {
  const el = document.getElementById("tab");
  el.innerHTML = `${search("ابحث بالاسم أو الماركة…")}<p class="p-small">لم تجد العطر؟ أرسل «طلب عطر جديد» وسنضيفه.</p><p class="p-count" id="cnt"></p>
    <ul class="p-list" id="list"></ul><button type="button" class="d-btn p-more" id="more" hidden>عرض المزيد</button>`;
  const mine = {}; S.offers.forEach((o) => { mine[o.perfume_id] = o; });
  const L = serverList({}, (p) => {
    const have = mine[p.perfume_id];
    return `<li class="p-item p-item-add" data-pid="${esc(p.perfume_id)}">${thumb(p)}
        <div class="p-name"><b dir="ltr">${esc(p.name)}</b><small><span dir="ltr">${esc(p.brand)}</span> · ${GENDER[p.gender] || ""}</small></div>
        ${have && have.active ? `<span class="p-have"><span class="p-tag is-ok">عندك${vlist(have).length > 1 ? " · " + vlist(have).length + " أحجام" : ""}</span><button type="button" class="p-link" data-act="add">📏 أضف أو عدّل الأحجام</button></span>`
          : `<button type="button" class="d-btn p-add" data-act="add">${have ? "إرجاع" : "+ أضف"}</button>`}</li>`;
  });
  const draw = L.draw;
  el.addEventListener("click", (e) => {
    if (!e.target.dataset || e.target.dataset.act !== "add") return;
    const li = e.target.closest(".p-item"), pid = li.dataset.pid, p = L.st.rows.find((x) => x.perfume_id === pid), have = mine[pid];
    if (!p) return;
    // a perfume the store already has: the same checklist, filled with its sizes (add a size or change a price)
    const start = !have ? [] : vlist(have).length ? vlist(have)
      : (have.price ? [{ type: have.size_type === "decant" ? "decant" : "full", size: have.size || p.size || "", price: have.price }] : []);
    const label = !have ? "إضافة العطر" : have.active ? "حفظ الأحجام" : "أرجِع العطر";
    openPicker(li, start, p.size, label, async (variants) => {
      if (have) {
        const ok = await save(have, have.active ? { variants } : { active: true, in_stock: true, variants }, have.active ? `تم الحفظ ${variants.length} ${variants.length === 1 ? "حجم" : "أحجام"} ✓` : "تم إرجاع العطر ✓");
        if (ok) draw(); return ok;
      }
      const { data, error } = await sb.from("offers").insert({ store_id: S.store.id, perfume_id: pid, variants, in_stock: true })
        .select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, variants, perfumes(name, brand, gender, image_url, size)").single();
      if (error) { toast(errText(error), true); return false; }
      S.offers.push(data); mine[pid] = data; toast(`تمت إضافة ${p.name} ✓`); askPublish(); draw(); return true;
    });
  });
}

// ask for a perfume that is not in the catalogue
function tabRequests() {
  const el = document.getElementById("tab");
  el.innerHTML = `<form id="f-req" class="p-form">
      <p class="p-small">العطر غير موجود في الكتالوگ؟ أعطنا الاسم والماركة، وسنضيفه بنوتاته وتصنيفه، ثم يظهر عندك.</p>
      <div class="p-grid2"><label>اسم العطر *<input name="perfume_name" required minlength="2" maxlength="120" dir="auto"></label>
      <label>الماركة<input name="brand" maxlength="80" dir="auto"></label>
      <label>الحجم<input name="size" maxlength="40" placeholder="100ml" dir="ltr"></label>
      <label>الثمن عندك (درهم)<input name="price" type="number" min="0" step="1" inputmode="decimal"></label></div>
      <label>ملاحظة<textarea name="note" maxlength="500" rows="2"></textarea></label>
      <button class="d-btn" type="submit">أرسل الطلب</button></form>
    <h2 class="p-h2">طلباتك</h2>
    ${S.requests.length ? `<ul class="p-reqs">${S.requests.map((r) => `<li><div><b dir="auto">${esc(r.perfume_name)}</b><small dir="auto">${esc(r.brand)}${r.size ? " · " + esc(r.size) : ""} · ${dateAr(r.created_at)}</small>
      ${r.admin_note ? `<p class="p-small">${esc(r.admin_note)}</p>` : ""}</div><span class="p-tag is-${r.status}">${STATUS[r.status]}</span></li>`).join("")}</ul>` : '<p class="d-empty">لم ترسل أي طلب بعد.</p>'}`;
  const f = document.getElementById("f-req");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { store_id: S.store.id, perfume_name: f.perfume_name.value.trim(), brand: f.brand.value.trim(), size: f.size.value.trim(),
      price: f.price.value === "" ? null : Number(f.price.value), note: f.note.value.trim() };
    if (row.perfume_name.length < 2) return toast("اكتب اسم العطر.", true);
    const b = f.querySelector("button"); b.disabled = true;
    const { data, error } = await sb.from("requests").insert(row).select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    S.requests.unshift(data); toast("تم إرسال الطلب ✓. سنراجعه."); render();
  });
}

// store details the merchant may change (contact and branding); the rest is set by RihaFlow
function tabSettings() {
  const s = S.store, el = document.getElementById("tab");
  const wa = String(s.whatsapp || "");
  el.innerHTML = `<form id="f-set" class="p-form" novalidate>
    <p class="p-small">تظهر هذه المعلومات للزبون في كويز متجرك. الاسم والاشتراك تعدّلهما RihaFlow.</p>
    <div class="p-grid2">
      <label>رقم الواتساب<input name="whatsapp" inputmode="tel" dir="ltr" placeholder="0612345678" value="${esc(wa.startsWith("212") ? "0" + wa.slice(3) : wa)}"><small class="p-small">الرقم الذي تصلك عليه رسائل الزبناء.</small></label>
      <label>المدينة<input name="city" maxlength="60" value="${esc(s.city || "")}"></label>
      <label>Instagram<input name="instagram" dir="ltr" placeholder="https://instagram.com/…" value="${esc(s.instagram || "")}"></label>
      <label>موقعك<input name="website" dir="ltr" placeholder="https://…" value="${esc(s.website || "")}"></label>
      <label>لون المتجر<span class="p-color"><input type="color" name="color" value="${/^#[0-9a-f]{6}$/i.test(s.color || "") ? esc(s.color) : "#5b35c8"}"><button type="button" class="p-link" id="b-nocolor">بدون لون</button></span></label>
    </div>
    <h2 class="p-h2">🎨 صفحة الكويز الخاصة بك</h2>
    <p class="p-small">يظهر هذا للزبون في أول صفحة الكويز. إذا تركتها فارغة، يظهر النص الافتراضي.</p>
    <fieldset class="p-themes"><legend>أجواء الصفحة</legend>
      ${[["luxury", "💜 فاخر", "بنفسجي وذهبي"], ["oriental", "🌙 شرقي", "عنابي وذهبي، عود وعنبر"], ["modern", "🤍 عصري", "أبيض وأسود، بسيط"], ["natural", "🌿 طبيعي", "أخضر وبيج، ورود ونباتات"]].map(([k, l, d]) =>
        `<label class="p-theme"><input type="radio" name="theme" value="${k}"${(s.theme || "luxury") === k ? " checked" : ""}>
          <img src="/images/themes/${k}-thumb.webp" alt="" width="320" height="180" loading="lazy"><span><b>${l}</b><small>${d}</small></span></label>`).join("")}
      <p class="p-small">لونك وصورة الغلاف (إذا رفعتها) لهما الأولوية على القالب.</p></fieldset>
    <div class="p-media">
      <div class="p-pic"><span class="p-pic-box p-pic-logo">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="اللوگو">` : esc((s.name || "?").slice(0, 2).toUpperCase())}</span>
        <div><b>اللوگو</b><small>مربع، PNG أو JPG</small>
          <label class="d-btn p-upload">ارفع اللوگو<input type="file" accept="image/png,image/jpeg,image/webp" data-up="logo_url" class="sr"></label>
          ${s.logo_url ? '<button type="button" class="p-link p-danger" data-rm="logo_url">إزالة</button>' : ""}</div></div>
      <div class="p-pic p-pic-wide"><span class="p-pic-box p-pic-cover">${s.cover_url ? `<img src="${esc(s.cover_url)}" alt="صورة الغلاف">` : "<small>بدون صورة</small>"}</span>
        <div><b>صورة الغلاف</b><small>عريضة: المحل أو الواجهة أو عطورك</small>
          <label class="d-btn p-upload">ارفع صورة<input type="file" accept="image/png,image/jpeg,image/webp" data-up="cover_url" class="sr"></label>
          ${s.cover_url ? '<button type="button" class="p-link p-danger" data-rm="cover_url">إزالة</button>' : ""}</div></div>
    </div>
    <div class="p-grid2">
      <label>العنوان<input name="welcome_title" maxlength="80" value="${esc(s.welcome_title || "")}" placeholder="اكتشف بصمتك العطرية مع ${esc(s.name)}"></label>
      <label>جملة الترحيب<textarea name="welcome_text" maxlength="300" rows="2" placeholder="أجب عن أسئلة بسيطة، ودع ${esc(s.name)} يكتشف لك العطور التي تشبه ذوقك.">${esc(s.welcome_text || "")}</textarea></label>
    </div>
    <button class="d-btn" type="submit">حفظ</button></form>
    <form id="f-pass" class="p-form p-pass" novalidate>
      <h2 class="p-h2">غيّر كلمة السر</h2>
      <div class="p-grid2"><label>كلمة السر الجديدة (8 أحرف أو أكثر)<input type="password" name="p1" minlength="8" autocomplete="new-password" dir="ltr"></label>
      <label>أعد كتابتها<input type="password" name="p2" minlength="8" autocomplete="new-password" dir="ltr"></label></div>
      <button class="d-btn" type="submit">غيّر كلمة السر</button></form>`;
  // pictures: resized in the browser, uploaded to the store's folder in Supabase Storage, then saved on the store
  el.addEventListener("change", async (e) => {
    const field = e.target.dataset && e.target.dataset.up, file = e.target.files && e.target.files[0];
    if (!field || !file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast("اختر صورة PNG أو JPG.", true);
    if (file.size > 15 * 1024 * 1024) return toast("الصورة كبيرة جداً (أكثر من 15 MB).", true);
    const lab = e.target.closest(".p-upload"); lab.classList.add("is-busy"); lab.firstChild.textContent = "جارٍ الرفع…";
    try {
      const blob = field === "logo_url" ? await shrinkImage(file, 512, 512) : await shrinkImage(file, 1600, 900);
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      const path = `${s.id}/${field === "logo_url" ? "logo" : "cover"}-${Date.now()}.${ext}`;
      const up = await sb.storage.from("store-assets").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
      if (up.error) throw up.error;
      const url = sb.storage.from("store-assets").getPublicUrl(path).data.publicUrl;
      const { data, error } = await sb.from("stores").update({ [field]: url }).eq("id", s.id).select("*").single();
      if (error) throw error;
      Object.assign(s, data); toast("تم حفظ الصورة ✓"); askPublish(); render();
    } catch (er) {
      lab.classList.remove("is-busy"); lab.firstChild.textContent = field === "logo_url" ? "ارفع اللوگو" : "ارفع صورة";
      toast(/bucket|not found/i.test(String(er && er.message)) ? "التخزين غير جاهز بعد (010_store_page.sql)." : errText(er), true);
    }
  });
  el.addEventListener("click", async (e) => {
    const field = e.target.dataset && e.target.dataset.rm; if (!field) return;
    const { data, error } = await sb.from("stores").update({ [field]: "" }).eq("id", s.id).select("*").single();
    if (error) return toast(errText(error), true);
    Object.assign(s, data); toast("تمت الإزالة ✓"); askPublish(); render();
  });
  const fp = document.getElementById("f-pass");
  fp.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (fp.p1.value.length < 8) return toast("يجب أن تتكون كلمة السر من 8 أحرف أو أكثر.", true);
    if (fp.p1.value !== fp.p2.value) return toast("كلمتا السر غير متطابقتين.", true);
    const { error } = await sb.auth.updateUser({ password: fp.p1.value });
    if (error) return toast(errText(error), true);
    fp.reset(); toast("تم تغيير كلمة السر ✓");
  });
  const f = document.getElementById("f-set");
  let noColor = !s.color;
  document.getElementById("b-nocolor").onclick = () => { noColor = true; toast("سيُزال اللون عند الحفظ."); };
  f.color.addEventListener("input", () => { noColor = false; });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const https = (v) => !v || /^https:\/\/\S+$/.test(v);
    let w = f.whatsapp.value.replace(/\D/g, "").replace(/^00/, "");
    if (/^0[5-7]\d{8}$/.test(w)) w = "212" + w.slice(1);
    const row = { whatsapp: w, city: f.city.value.trim(), instagram: f.instagram.value.trim(), website: f.website.value.trim(),
      color: noColor ? "" : f.color.value.toLowerCase(), welcome_title: f.welcome_title.value.trim(), welcome_text: f.welcome_text.value.trim(),
      theme: (f.querySelector("input[name=theme]:checked") || {}).value || "luxury" };
    if (w && !/^\d{11,15}$/.test(w)) return toast("رقم الواتساب غير صحيح. مثال: 0612345678", true);
    for (const k of ["instagram", "website"]) if (!https(row[k])) return toast("يجب أن تبدأ الروابط بـ https://", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const { data, error } = await sb.from("stores").update(row).eq("id", s.id).select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    Object.assign(s, data); toast("تم حفظ المعلومات ✓"); askPublish(); render();
  });
}

// shrink a picture before upload (a phone photo of 5 MB becomes ~150 KB); WebP when the browser can, else JPEG
// one perfume's photo → WebP (600 px at most) in the «perfume-images» bucket (025), then perfumes.image_url;
// the previous photo of this perfume in the bucket is removed. Returns the saved perfume, or null.
async function uploadPerfumePhoto(p, file, lab) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast("اختر صورة PNG أو JPG أو WebP.", true); return null; }
  if (file.size > 15 * 1024 * 1024) { toast("الصورة كبيرة جداً (أكثر من 15 MB).", true); return null; }
  const text = lab.firstChild.textContent;
  lab.classList.add("is-busy"); lab.firstChild.textContent = "جارٍ الرفع…";
  try {
    const blob = await shrinkImage(file, 600, 600);
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const key = String(p.master_id || p.perfume_id).replace(/[^\w-]/g, "");
    const path = `${key}-${Date.now()}.${ext}`;
    const bucket = sb.storage.from("perfume-images");
    const up = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (up.error) throw up.error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    const { data, error } = await sb.from("perfumes").update({ image_url: url }).eq("perfume_id", p.perfume_id).select("*").single();
    if (error) { await bucket.remove([path]); throw error; }
    const old = String(p.image_url || "").split("/perfume-images/")[1];
    if (old) bucket.remove([decodeURIComponent(old.split("?")[0])]).catch(() => {});
    toast(`تم حفظ صورة ${data.name} ✓`); S.catalog = null; askPublish();
    return data;
  } catch (er) {
    lab.classList.remove("is-busy"); lab.firstChild.textContent = text;
    toast(/bucket|not found/i.test(String(er && er.message)) ? "التخزين غير جاهز بعد: شغّل 025_perfume_images.sql في Supabase." : errText(er), true);
    return null;
  }
}
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

// RihaFlow team: create merchant logins (and new stores), new temporary passwords, remove access
function shareBox(r) {
  const url = location.origin + "/portal/";
  const msg = `مرحباً 👋\nهذا حسابك في RihaFlow:\n${url}\nالبريد الإلكتروني: ${r.email}\nكلمة السر المؤقتة: ${r.password}\nبعد الدخول، غيّر كلمة السر من «⚙️ إعدادات المتجر».`;
  return `<div class="p-share"><p><b>${esc(r.email)}</b></p>
    <p>كلمة السر المؤقتة: <code dir="ltr">${esc(r.password)}</code></p>
    <p class="p-small">لن تظهر مرة أخرى. أرسلها للتاجر الآن.</p>
    <div class="p-review"><button type="button" class="d-btn" data-copy="${esc(msg)}">انسخ الرسالة</button>
    <a class="p-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">أرسل عبر الواتساب</a></div></div>`;
}
// 🏪 المتاجر › «+ متجر جديد» (mode "new": the form) and «الحسابات» (mode "list": every merchant login)
async function tabAccounts(mode) {
  const el = document.getElementById("tab");
  if (mode === "list") {
    el.innerHTML = '<div id="acc-result"></div><ul class="p-reqs" id="acc-list"><li class="d-empty">جارٍ تحميل الحسابات…</li></ul>';
    accountsList(el); return;
  }
  el.innerHTML = `<form id="f-acc" class="p-form" novalidate>
      <h2 class="p-h2">متجر جديد وحساب تاجر</h2>
      <div class="p-grid2"><label>البريد الإلكتروني للتاجر<input type="email" name="email" required dir="ltr" autocomplete="off"></label>
      <label>المتجر<select name="store"><option value="">+ متجر جديد</option>${S.stores.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.id)})</option>`).join("")}</select></label></div>
      <div class="p-grid2 p-newstore"><label>store_id (في الرابط)<input name="store_id" dir="ltr" placeholder="parfumerie-x" pattern="[a-z0-9][a-z0-9-]{1,40}"></label>
        <label>اسم المتجر<input name="name" maxlength="80"></label>
        <label>المدينة<input name="city" maxlength="60"></label>
        <label>رقم الواتساب<input name="whatsapp" inputmode="tel" dir="ltr" placeholder="0612345678"></label></div>
      <p class="p-small">يبدأ المتجر الجديد بفترة تجريبية مدتها 7 أيام. يحصل التاجر على كلمة سر مؤقتة ترسلها له أنت.</p>
      <button class="d-btn" type="submit">أنشئ الحساب</button></form>
    <div id="acc-result"></div>`;
  const f = document.getElementById("f-acc"), ns = el.querySelector(".p-newstore"), out = document.getElementById("acc-result");
  const toggle = () => { ns.hidden = !!f.store.value; };
  if (S.prefill && S.stores.some((x) => x.id === S.prefill)) { f.store.value = S.prefill; S.prefill = ""; setTimeout(() => f.email.focus(), 50); }
  f.store.addEventListener("change", toggle); toggle();
  f.name.addEventListener("input", () => { if (!f.store_id.dataset.touched) f.store_id.value = f.name.value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); });
  f.store_id.addEventListener("input", () => { f.store_id.dataset.touched = "1"; });
  el.addEventListener("click", copyHandler);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { email: f.email.value.trim() };
    if (f.store.value) body.store_id = f.store.value;
    else Object.assign(body, { store_id: f.store_id.value.trim(), name: f.name.value.trim(), city: f.city.value.trim(), whatsapp: f.whatsapp.value.trim() });
    if (!/^\S+@\S+\.\S+$/.test(body.email)) return toast("اكتب بريداً إلكترونياً صحيحاً.", true);
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(body.store_id || "")) return toast("store_id: أحرف صغيرة (a-z) وأرقام و - فقط.", true);
    if (!f.store.value && !body.name) return toast("اكتب اسم المتجر.", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true; b.textContent = "جارٍ الإنشاء…";
    let r; try { r = await teamCall("createMerchant", body); } catch (er) { r = { error: "failed" }; }
    b.disabled = false; b.textContent = "أنشئ الحساب";
    if (r.error) return toast(r.error === "invalid" ? "هذا الإجراء خاص بفريق RihaFlow." : (r.message || "لم يتم إنشاء الحساب."), true);
    out.innerHTML = r.new_user ? shareBox(r) : `<div class="p-share"><p><b>${esc(r.email)}</b> كان لديه حساب من قبل، وتم ربطه الآن بـ <b>${esc(r.store_id)}</b>. يدخل بكلمة السر الخاصة به.</p></div>`;
    if (r.store_created) { const all = await sb.from("stores").select("*").order("name"); if (!all.error) S.stores = all.data; }
    f.reset(); toggle(); toast("تم الإنشاء ✓");
  });
}

async function copyHandler(e) {
  const c = e.target.dataset && e.target.dataset.copy;
  if (!c) return;
  try { await navigator.clipboard.writeText(c); toast("تم النسخ ✓"); } catch (er) { toast("لم يتم النسخ. حدّدها يدوياً.", true); }
}
function accountsList(el) {
  const out = document.getElementById("acc-result");
  el.addEventListener("click", copyHandler);
  el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.dataset.reset) {
      t.disabled = true; const r = await teamCall("resetPassword", { user_id: t.dataset.reset }); t.disabled = false;
      if (r.error) return toast(r.message || "لم يتم التغيير.", true);
      out.innerHTML = shareBox(r); out.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (t.dataset.unlink) {
      const [uid, sid] = t.dataset.unlink.split("|");
      if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "متأكد؟"; return; }
      const r = await teamCall("unlinkMerchant", { user_id: uid, store_id: sid });
      if (r.error) return toast(r.message || "لم تتم الإزالة.", true);
      toast("تمت إزالة الوصول ✓"); loadList();
    }
  });
  async function loadList() {
    const ul = document.getElementById("acc-list");
    const r = await teamCall("merchants");
    if (r.error) { ul.innerHTML = `<li class="d-empty">${esc(r.message || "تعذّر تحميل الحسابات. تأكد أن Apps Script فيه المفتاح السري وأنه نُشر بـ New version.")}</li>`; return; }
    ul.innerHTML = r.accounts.length ? r.accounts.map((a) => `<li><div><b dir="ltr">${esc(a.email)}</b><small>${esc(a.store)} · ${a.last_sign_in_at ? "آخر دخول " + dateAr(a.last_sign_in_at) : "لم يدخل بعد"}</small></div>
      <div class="p-review"><button type="button" class="p-link" data-reset="${esc(a.user_id)}">كلمة سر جديدة</button>
      ${isBoss() ? `<button type="button" class="p-link p-danger" data-unlink="${esc(a.user_id)}|${esc(a.store_id)}">أزل الوصول</button>` : ""}</div></li>`).join("")
      : '<li class="d-empty">لا يوجد أي حساب تاجر بعد.</li>';
  }
  loadList();
}

// 🏪 المتاجر › الاشتراكات (admin): status and end of trial of every store (set_subscription, 016)
const SUB_LABEL = { trial: "تجربة", active: "مفعّل", paused: "موقوف", cancelled: "ملغى" };
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
function tabSubs() {
  const el = document.getElementById("tab");
  const list = S.stores.filter((x) => x.id !== "demo");
  el.innerHTML = `<p class="p-small">التاجر لا يرى هذه الصفحة، والـ Agent لا يستطيع تغيير الاشتراك. المتجر في التجربة أو المفعّل يظهر للزبناء.</p>
    <ul class="p-reqs p-subs">${list.map((x) => {
      const st = x.subscription_status, end = x.trial_ends_at ? isoDay(x.trial_ends_at) : "";
      const late = st === "trial" && x.trial_ends_at && daysLeft(x.trial_ends_at) <= 0;
      return `<li data-sid="${esc(x.id)}"><div><b>${esc(x.name)}</b><small dir="ltr">${esc(x.id)}</small>
          <small class="${late ? "p-sub-late" : ""}">${SUB_LABEL[st] || st}${st === "trial" && end ? (late ? " · انتهت يوم " : " · حتى ") + dateAr(x.trial_ends_at) : ""}</small></div>
        <div class="p-sub-edit"><label><span class="sr">الاشتراك</span><select data-f="status">${Object.entries(SUB_LABEL).map(([k, l]) => `<option value="${k}"${k === st ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="p-sub-end"${st === "trial" ? "" : " hidden"}><span class="sr">نهاية التجربة</span><input type="date" data-f="end" value="${esc(end && !late ? end : isoDay(Date.now() + 7 * 864e5))}" dir="ltr"></label>
          <button type="button" class="d-btn" data-save>حفظ</button></div></li>`; }).join("") || '<li class="d-empty">لا توجد متاجر بعد.</li>'}</ul>`;
  el.querySelectorAll('[data-f="status"]').forEach((s) => s.addEventListener("change", () => { s.closest("li").querySelector(".p-sub-end").hidden = s.value !== "trial"; }));
  // opened from an alert: that store is highlighted and its choice gets the focus
  const hit = S.prefill && el.querySelector(`li[data-sid="${CSS.escape(S.prefill)}"]`); S.prefill = "";
  subsPaid(el, list);
  if (hit) { hit.classList.add("is-hit"); setTimeout(() => { hit.scrollIntoView({ block: "center" }); hit.querySelector("select").focus({ preventScroll: true }); }, 50); }
  el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const li = b.closest("li"), sid = li.dataset.sid, status = li.querySelector('[data-f="status"]').value, day = li.querySelector('[data-f="end"]').value;
    const p = { p_store: sid, p_status: status };
    if (status === "trial") { if (!day) return toast("اختر تاريخ نهاية التجربة.", true); p.p_trial_end = new Date(day + "T23:59:00").toISOString(); }
    b.disabled = true;
    const r = await sb.rpc("set_subscription", p);
    b.disabled = false;
    if (r.error) return toast(/set_subscription|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "شغّل 016_team_roles.sql في Supabase أولاً." : errText(r.error), true);
    if (r.data && r.data.error) return toast({ forbidden: "هذا الإجراء خاص بالـ admin.", date: "تاريخ نهاية التجربة غير صحيح.", store: "المتجر غير موجود." }[r.data.error] || "لم يتم الحفظ.", true);
    const x = S.stores.find((y) => y.id === sid); Object.assign(x, { subscription_status: r.data.subscription_status, trial_ends_at: r.data.trial_ends_at });
    toast("تم حفظ الاشتراك ✓"); askPublish(); tabSubs();
  }));
}

// the subscriptions list also shows what each store paid and the money recorded this month and last month (019)
async function subsPaid(el, list) {
  const r = await sb.from("store_payments").select("store_id, amount, paid_at, paid_until").order("paid_at", { ascending: false }).limit(2000);
  if (r.error || S.teamTab !== "subs") return;
  const today = todayISO(), m0 = today.slice(0, 7), d = new Date(today + "T12:00:00"); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const m1 = d.toLocaleDateString("en-CA").slice(0, 7);
  const sum = (m) => r.data.filter((p) => p.paid_at.slice(0, 7) === m).reduce((s, p) => s + Number(p.amount), 0);
  const head = document.createElement("p"); head.className = "p-pay-sum";
  head.innerHTML = `المداخيل المسجلة: هذا الشهر <b>${fmt(sum(m0))} درهم</b> · الشهر الماضي <b>${fmt(sum(m1))} درهم</b>`;
  el.prepend(head);
  list.forEach((x) => {
    const li = el.querySelector(`li[data-sid="${CSS.escape(x.id)}"] > div`); if (!li) return;
    const until = r.data.filter((p) => p.store_id === x.id).reduce((m, p) => (p.paid_until > m ? p.paid_until : m), "");
    const s = document.createElement("small");
    const late = until && until < today && x.subscription_status === "active";
    s.className = late ? "p-sub-late" : "";
    s.textContent = !until ? "لا يوجد أداء مسجل" : late ? `⚠️ متأخر · آخر أداء حتى ${dateAr(until)}` : `💰 مؤدى حتى ${dateAr(until)}`;
    li.append(s);
  });
}

// 👥 الفريق › الأعضاء (admin): who is in the team and with which role; add, change the role, remove
function teamShare(r) {
  const url = location.origin + "/portal/";
  const msg = `مرحباً 👋\nهذا حسابك في فريق RihaFlow:\n${url}\nالبريد الإلكتروني: ${r.email}\nكلمة السر المؤقتة: ${r.password}\nيمكنك تغييرها من «نسيت كلمة السر؟» في صفحة الدخول.`;
  return `<div class="p-share"><p><b>${esc(r.email)}</b> · ${r.role === "admin" ? "Admin" : "Agent"}</p>
    <p>كلمة السر المؤقتة: <code dir="ltr">${esc(r.password)}</code></p>
    <p class="p-small">لن تظهر مرة أخرى. أرسلها الآن.</p>
    <div class="p-review"><button type="button" class="d-btn" data-copy="${esc(msg)}">انسخ الرسالة</button>
    <a class="p-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">أرسل عبر الواتساب</a></div></div>`;
}
async function tabMembers() {
  const el = document.getElementById("tab");
  el.innerHTML = `<form id="f-team" class="p-form" novalidate>
      <h2 class="p-h2">إضافة عضو</h2>
      <div class="p-grid2"><label>البريد الإلكتروني<input type="email" name="email" required dir="ltr" autocomplete="off"></label>
      <label>الدور<select name="role"><option value="agent">Agent: العمل اليومي</option><option value="admin">Admin: كل الصلاحيات</option></select></label></div>
      <p class="p-small"><b>Agent</b>: الكاتالوگ، الطلبات، مساعدة المتاجر، وإنشاء متاجر وحسابات جديدة. <b>Admin</b>: كل ذلك، والاشتراكات، وإزالة الحسابات، والفريق، والمداخيل، وسجل النشاط.</p>
      <button class="d-btn" type="submit">أضف للفريق</button></form>
    <div id="team-result"></div>
    <h2 class="p-h2">الفريق</h2><ul class="p-reqs" id="team-list"><li class="d-empty">جارٍ تحميل الفريق…</li></ul>`;
  const f = document.getElementById("f-team"), out = document.getElementById("team-result");
  el.addEventListener("click", copyHandler);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = f.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("اكتب بريداً إلكترونياً صحيحاً.", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const r = await teamCall("addTeam", { email, role: f.role.value });
    b.disabled = false;
    if (r.error) return toast(r.message || "لم تتم الإضافة.", true);
    out.innerHTML = r.new_user ? teamShare(r) : `<div class="p-share"><p><b>${esc(r.email)}</b> كان لديه حساب، وأصبح الآن في الفريق (${r.role === "admin" ? "Admin" : "Agent"}). يدخل بكلمة السر الخاصة به.</p></div>`;
    f.reset(); toast("تمت الإضافة ✓"); load();
  });
  async function load() {
    const ul = document.getElementById("team-list");
    const r = await teamCall("team");
    if (r.error) { ul.innerHTML = `<li class="d-empty">${esc(r.message || "تعذّر تحميل الفريق.")}</li>`; return; }
    ul.innerHTML = r.members.map((m) => { const me = m.user_id === S.user.id; return `<li data-uid="${esc(m.user_id)}"><div><b dir="ltr">${esc(m.email)}</b>
        <small>${me ? "أنت · " : ""}${m.last_sign_in_at ? "آخر دخول " + dateAr(m.last_sign_in_at) : "لم يدخل بعد"}</small></div>
      <div class="p-review"><label><span class="sr">الدور</span><select data-role${me ? " disabled" : ""}><option value="agent"${m.role === "agent" ? " selected" : ""}>Agent</option><option value="admin"${m.role === "admin" ? " selected" : ""}>Admin</option></select></label>
      ${me ? "" : '<button type="button" class="p-link p-danger" data-rm>إزالة من الفريق</button>'}</div></li>`; }).join("");
    ul.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", async () => {
      const r2 = await teamCall("setRole", { user_id: s.closest("li").dataset.uid, role: s.value });
      if (r2.error) { toast(r2.message || "لم يتم التغيير.", true); return load(); }
      toast("تم تغيير الدور ✓");
    }));
    ul.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "متأكد؟"; return; }
      const r2 = await teamCall("removeTeam", { user_id: b.closest("li").dataset.uid });
      if (r2.error) return toast(r2.message || "لم تتم الإزالة.", true);
      toast("تمت الإزالة ✓"); load();
    }));
  }
  load();
}

// 👥 الفريق › سجل النشاط (admin): who changed what and when (activity_list, 016)
const LOG_ACTION = {
  "perfumes.insert": "أضاف عطراً للكاتالوگ", "perfumes.update": "عدّل عطراً في الكاتالوگ", "perfumes.delete": "حذف عطراً من الكاتالوگ",
  "stores.insert": "أنشأ متجراً", "stores.update": "عدّل متجراً", "stores.delete": "حذف متجراً",
  "offers.insert": "أضاف عطراً لمتجر", "offers.update": "عدّل عطراً في متجر", "offers.delete": "حذف عطراً من متجر",
  "requests.insert": "أرسل طلب عطر", "requests.update": "راجع طلب عطر", "requests.delete": "حذف طلب عطر",
  "store_members.insert": "ربط حساباً بمتجر", "store_members.delete": "أزال حساباً من متجر",
  "team.createMerchant": "أنشأ حساب تاجر", "team.resetPassword": "أعطى كلمة سر جديدة", "team.unlinkMerchant": "أزال وصول حساب لمتجر",
  "store_payments.insert": "سجّل أداءً", "store_payments.update": "عدّل أداءً", "store_payments.delete": "حذف أداءً",
  "store_notes.insert": "أضاف ملاحظة", "store_notes.update": "حدّث ملاحظة", "store_notes.delete": "حذف ملاحظة",
  "team.changeEmail": "غيّر بريد حساب تاجر", "team.addTeam": "أضاف عضواً للفريق", "team.setRole": "غيّر دور عضو", "team.removeTeam": "أزال عضواً من الفريق",
};
const LOG_FIELD = { price: "الثمن", in_stock: "التوفر", active: "نشط", variants: "الأحجام", name: "الاسم", brand: "الماركة", gender: "لمن", subscription_status: "الاشتراك",
  trial_ends_at: "نهاية التجربة", status: "الحالة", admin_note: "ملاحظة", city: "المدينة", whatsapp: "الواتساب", instagram: "Instagram", website: "الموقع", color: "اللون",
  logo_url: "اللوگو", cover_url: "صورة الغلاف", theme: "الأجواء", welcome_title: "العنوان", welcome_text: "جملة الترحيب", role: "الدور", character: "العائلة", occasion: "المناسبة",
  season: "الفصل", notes_top: "نوتات الافتتاح", notes_mid: "نوتات القلب", notes_base: "نوتات القاعدة", concentration: "التركيز", size: "الحجم", image_url: "الصورة", world: "الفئة",
  store_created: "متجر جديد", new_user: "حساب جديد", email: "البريد الإلكتروني", done: "تمت المتابعة", follow_up: "التذكير", amount: "المبلغ", paid_until: "مؤدى حتى", paid_at: "تاريخ الأداء", method: "الطريقة", body: "الملاحظة" };
function logVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "نعم"; if (v === false) return "لا";
  if (Array.isArray(v) && v.every((x) => x && x.size)) return v.map((x) => `${x.size}${x.price ? " = " + x.price : ""}`).join("، ");
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return dateAr(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(SUB_LABEL[v] || STATUS[v] || v).slice(0, 80);
}
function logDetail(d) {
  if (!d || typeof d !== "object" || d.new) return "";
  // an update is {field: [before, after]}; an Apps Script action is {field: value}
  return Object.entries(d).map(([k, v]) => `<span><em>${esc(LOG_FIELD[k] || k)}:</em> ${Array.isArray(v) && v.length === 2 && !(v[0] && v[0].size)
    ? `${esc(logVal(v[0]))} ← ${esc(logVal(v[1]))}` : esc(logVal(v))}</span>`).join("");
}
async function tabLog() {
  const el = document.getElementById("tab");
  const st = { rows: [], actor: "", done: false };
  el.innerHTML = `<div class="p-review p-log-tools"><label>الشخص<select id="log-actor"><option value="">الجميع</option></select></label></div>
    <ul class="p-log" id="log-list"><li class="d-empty">جارٍ تحميل السجل…</li></ul><button type="button" class="d-btn p-more" id="log-more" hidden>عرض المزيد</button>`;
  const ul = document.getElementById("log-list"), more = document.getElementById("log-more"), sel = document.getElementById("log-actor");
  teamCall("team").then((r) => { if (r && r.members) sel.innerHTML = '<option value="">الجميع</option>' + r.members.map((m) => `<option value="${esc(m.email)}">${esc(m.email)}</option>`).join(""); }).catch(() => {});
  const fmtTime = (d) => new Date(d).toLocaleString("ar-MA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const draw = () => {
    ul.innerHTML = st.rows.length ? st.rows.map((x) => `<li><time datetime="${esc(x.at)}">${fmtTime(x.at)}</time>
      <div><p><b dir="ltr">${esc(x.actor_email || "—")}</b> <span class="p-role is-${esc(x.actor_role)}">${x.actor_role === "agent" ? "Agent" : "Admin"}</span> ${esc(LOG_ACTION[x.action] || x.action)}</p>
        <p class="p-log-what">${x.target ? `<b dir="auto">${esc(x.target)}</b>` : ""}${x.store_id && !/^stores\./.test(x.action) ? ` · <span dir="ltr">${esc(x.store_id)}</span>` : ""}</p>
        <p class="p-log-d">${logDetail(x.detail)}</p></div></li>`).join("") : '<li class="d-empty">لا يوجد أي نشاط بعد.</li>';
    more.hidden = st.done;
  };
  const load = async (reset) => {
    if (reset) { st.rows = []; st.done = false; ul.innerHTML = '<li class="d-empty">جارٍ تحميل السجل…</li>'; }
    more.disabled = true;
    const r = await sb.rpc("activity_list", { p_limit: 50, p_before: st.rows.length ? st.rows[st.rows.length - 1].id : null, p_actor: st.actor || null });
    more.disabled = false;
    if (r.error) { ul.innerHTML = `<li class="d-empty">${/activity_list|PGRST202|42883/.test((r.error.message || "") + r.error.code) ? "شغّل 016_team_roles.sql في Supabase أولاً." : errText(r.error)}</li>`; return; }
    st.rows = st.rows.concat(r.data || []); st.done = (r.data || []).length < 50; draw();
  };
  sel.addEventListener("change", () => { st.actor = sel.value; load(true); });
  more.addEventListener("click", () => load(false));
  load(true);
}

// RihaFlow team: the master catalogue (what the quiz knows about every perfume)
const P_FAMILY = { fresh: "منعش", citrus: "حمضي", woody: "خشبي", aquatic: "أكواتيك", oriental: "شرقي", sweet: "حلو", heavy: "ثقيل وعميق", fruity: "فاكهي", floral: "زهري", clean: "نظيف", musky: "مسكي" };
const P_OCCASION = { daily: "يومي / العمل", dates: "الأمسيات الخاصة", evening: "السهرات", travel: "السفر", allday: "كل الأوقات" };
const P_SEASON = { spring: "ربيع", summer: "صيف", autumn: "خريف", winter: "شتاء", allseasons: "طول العام" };
const P_WORLD = { "": "بدون تصنيف", designer: "Designer", niche: "Niche", ultra_niche: "Ultra-Niche", arabian: "Arabian" };
const P_GENDER = { men: "رجالي", women: "نسائي", unisex: "للجميع" };
const P_CONC = ["EDP", "EDT", "Parfum", "Extrait", "EDC"];
async function tabPerfumes() {
  const el = document.getElementById("tab");
  S.pFilter = S.pFilter || "all";
  el.innerHTML = `<div class="p-review p-ptools">${search("ابحث بالاسم أو الماركة أو الرقم (FF-…)")}<button type="button" class="d-btn" id="b-newp">+ عطر جديد</button></div>
    <div class="p-filters" role="group" aria-label="عرض">${[["all", "الكل"], ["noimg", "بدون صورة"]].map(([k, l]) => `<button type="button" data-pf="${k}" aria-pressed="${S.pFilter === k}">${l}</button>`).join("")}</div>
    <p class="p-small">هذه هي القاعدة التي يعمل بها المحرك. أي تعديل يظهر في الكويز بعد النشر. الصورة مشتركة بين كل المتاجر التي تبيع العطر.</p><p class="p-count" id="cnt"></p>
    <ul class="p-list" id="list"></ul><button type="button" class="d-btn p-more" id="more" hidden>عرض المزيد</button>`;
  const L = serverList({ all: true, noImage: S.pFilter === "noimg" }, (p) => `<li class="p-item p-item-add${p.active ? "" : " is-removed"}" data-pid="${esc(p.perfume_id)}">${thumb(p)}
      <div class="p-name"><b dir="ltr">${esc(p.name)}</b><small><span dir="ltr">${esc(p.brand)}</span> · ${P_GENDER[p.gender] || ""} · <span dir="ltr">${esc(p.perfume_id)}</span>${p.ref_price ? " · " + fmt(p.ref_price) + " درهم" : ""}</small></div>
      <span class="p-have">${p.active ? "" : '<span class="p-tag">موقوف</span>'}
        <label class="p-link p-photo">${p.image_url ? "تغيير الصورة" : "📷 أضف صورة"}<input type="file" class="sr" accept="image/png,image/jpeg,image/webp" data-photo="${esc(p.perfume_id)}"></label>
        <button type="button" class="p-link" data-edit="${esc(p.perfume_id)}">✏️ تعديل</button></span></li>`);
  const all = L.st, draw = L.draw;
  el.querySelectorAll("[data-pf]").forEach((b) => b.addEventListener("click", () => { S.pFilter = b.dataset.pf; tabPerfumes(); }));
  // handlers set (not added): the tab is redrawn when the filter changes, and one upload must stay one upload
  el.onchange = async (e) => {
    const id = e.target.dataset && e.target.dataset.photo, file = e.target.files && e.target.files[0];
    if (!id || !file) return;
    const p = all.rows.find((x) => x.perfume_id === id), lab = e.target.closest(".p-photo");
    const saved = await uploadPerfumePhoto(p, file, lab);
    if (!saved) return;
    Object.assign(p, saved);
    if (S.pFilter === "noimg") { all.rows = all.rows.filter((x) => x.perfume_id !== id); all.total = Math.max(0, all.total - 1); }
    draw();
    if (S.pFilter === "noimg" && !all.total && !S.q) document.getElementById("list").innerHTML = '<li class="d-empty">كل العطور النشيطة عندها صورة ✅</li>';
  };
  el.onclick = (e) => {
    const id = e.target.dataset && e.target.dataset.edit;
    if (id) perfumeForm(e.target.closest(".p-item"), all.rows.find((p) => p.perfume_id === id), (saved) => { Object.assign(all.rows.find((p) => p.perfume_id === saved.perfume_id), saved); draw(); });
    if (e.target.id === "b-newp") perfumeForm(null, null, (saved) => { all.rows.unshift(saved); all.total += 1; draw(); });
  };
}
const chipSet = (name, labels, chosen) => `<div class="p-chips" role="group" aria-label="${name}">${Object.keys(labels).map((k) =>
  `<label class="p-chip2"><input type="checkbox" name="${name}" value="${k}"${chosen.includes(k) ? " checked" : ""}><span>${labels[k]}</span></label>`).join("")}</div>`;
const csv = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
// add or edit one perfume; prefill (from a request) fills a new one; onSaved(row)
async function perfumeForm(afterLi, p, onSaved, prefill = {}) {
  document.querySelectorAll(".p-pform-row").forEach((x) => x.remove());
  const isNew = !p;
  let id = p ? p.perfume_id : "";
  if (isNew) { const r = await sb.rpc("next_perfume_id"); if (r.error || !r.data) return toast("تعذّر الحصول على رقم جديد. تأكد من 009_phase3.sql.", true); id = r.data; }
  const v = p || { perfume_id: id, name: prefill.name || "", brand: prefill.brand || "", gender: "unisex", character: "", occasion: "", season: "", notes_top: "", notes_mid: "", notes_base: "",
    concentration: "EDP", size: prefill.size || "", size_type: "full", ref_price: prefill.price || null, world: "", image_url: "", active: true };
  const box = document.createElement(afterLi ? "li" : "div");
  box.className = "p-pform-row";
  box.innerHTML = `<form class="p-sizes p-pform" novalidate>
    <h3>${isNew ? "عطر جديد" : "تعديل العطر"} <span dir="ltr" class="p-tag">${esc(id)}</span></h3>
    <div class="p-grid2"><label>الاسم *<input name="name" required maxlength="120" dir="ltr" value="${esc(v.name)}"></label>
      <label>الماركة *<input name="brand" required maxlength="80" dir="ltr" value="${esc(v.brand)}"></label>
      <label>لمن؟<select name="gender">${Object.keys(P_GENDER).map((k) => `<option value="${k}"${v.gender === k ? " selected" : ""}>${P_GENDER[k]}</option>`).join("")}</select></label>
      <label>العالم<select name="world">${Object.keys(P_WORLD).map((k) => `<option value="${k}"${(v.world || "") === k ? " selected" : ""}>${P_WORLD[k]}</option>`).join("")}</select></label></div>
    <fieldset><legend>العائلة (الطابع) *</legend>${chipSet("character", P_FAMILY, csv(v.character))}</fieldset>
    <fieldset><legend>المناسبة</legend>${chipSet("occasion", P_OCCASION, csv(v.occasion))}</fieldset>
    <fieldset><legend>الموسم</legend>${chipSet("season", P_SEASON, csv(v.season))}</fieldset>
    <div class="p-grid2"><label>نوتات الافتتاح (مفصولة بفاصلة)<input name="notes_top" dir="ltr" value="${esc(v.notes_top)}" placeholder="Bergamot, Pepper"></label>
      <label>نوتات القلب<input name="notes_mid" dir="ltr" value="${esc(v.notes_mid)}"></label>
      <label>نوتات القاعدة<input name="notes_base" dir="ltr" value="${esc(v.notes_base)}"></label>
      <label>التركيز<select name="concentration">${P_CONC.map((c) => `<option${v.concentration === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>الحجم المرجعي<input name="size" dir="ltr" maxlength="20" value="${esc(v.size)}" placeholder="100ml"></label>
      <label>الثمن المرجعي (درهم)<input name="ref_price" type="number" min="0" step="1" value="${v.ref_price ?? ""}"></label>
      <label>رابط الصورة (https)<input name="image_url" dir="ltr" value="${esc(v.image_url)}" placeholder="https://res.cloudinary.com/…"></label>
      <label class="p-chk p-activechk"><input type="checkbox" name="active"${v.active ? " checked" : ""}><span>يظهر في الكويز</span></label></div>
    <div class="p-review"><span class="p-grow"></span><button type="button" class="p-link" data-k="cancel">إلغاء</button><button type="submit" class="d-btn">${isNew ? "أضف العطر" : "حفظ"}</button></div></form>`;
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
    if (!row.name || !row.brand) return toast("الاسم والماركة ضروريان.", true);
    if (!row.character) return toast("اختر عائلة واحدة على الأقل: يحتاجها المحرك.", true);
    if (row.image_url && !/^https:\/\//.test(row.image_url)) return toast("يجب أن يبدأ رابط الصورة بـ https://", true);
    const b = f.querySelector("[type=submit]"); b.disabled = true;
    const q = isNew ? sb.from("perfumes").insert({ perfume_id: id, size_type: "full", ...row }) : sb.from("perfumes").update(row).eq("perfume_id", id);
    const { data, error } = await q.select("*").single();
    b.disabled = false;
    if (error) return toast(errText(error), true);
    toast(isNew ? `تمت إضافة ${data.name} ✓` : "تم الحفظ ✓"); S.catalog = null; box.remove(); onSaved(data);
  });
}

// RihaFlow team: review requests from every store
async function tabReview() {
  const el = document.getElementById("tab");
  el.innerHTML = '<p class="d-empty">جارٍ تحميل الطلبات…</p>';
  const { data, error } = await sb.from("requests").select("*, stores(name)").order("created_at", { ascending: false }).limit(200);
  if (error) { el.innerHTML = `<p class="d-msg">${errText(error)}</p>`; return; }
  const pend = data.filter((r) => r.status === "pending"), done = data.filter((r) => r.status !== "pending").slice(0, 30);
  const row = (r) => `<li data-id="${r.id}"><div><b dir="auto">${esc(r.perfume_name)}</b> <small dir="auto">${esc(r.brand)}${r.size ? " · " + esc(r.size) : ""}${r.price ? " · " + fmt(r.price) + " درهم" : ""}</small>
      <small>${esc(r.stores?.name || r.store_id)} · ${dateAr(r.created_at)}</small>${r.note ? `<p class="p-small">${esc(r.note)}</p>` : ""}</div>
      ${r.status === "pending" ? `<div class="p-review"><input placeholder="ملاحظة للتاجر (اختياري)" maxlength="300" data-note>
        <button type="button" class="d-btn" data-addp="${r.id}">اقبل وأضف العطر</button><button type="button" class="p-link" data-st="approved">اقبل فقط</button><button type="button" class="p-link" data-st="rejected">رفض</button></div>`
        : `<span class="p-tag is-${r.status}">${STATUS[r.status]}</span>`}</li>`;
  el.innerHTML = `<h2 class="p-h2">قيد المراجعة (${pend.length})</h2>${pend.length ? `<ul class="p-reqs">${pend.map(row).join("")}</ul>` : '<p class="d-empty">لا يوجد أي طلب قيد المراجعة ✅</p>'}
    <p class="p-small">عند قبول طلب: أضف العطر في Perfumes بتصنيفه، ثم يمكن للتاجر إضافته من «أضف عطراً».</p>
    ${done.length ? `<h2 class="p-h2">آخر الطلبات التي تمت مراجعتها</h2><ul class="p-reqs">${done.map(row).join("")}</ul>` : ""}`;
  el.addEventListener("click", async (e) => {
    const addp = e.target.dataset && e.target.dataset.addp;
    if (addp) {
      const r = data.find((x) => String(x.id) === addp), li = e.target.closest("li");
      return perfumeForm(li, null, async (saved) => {
        const note = li.querySelector("[data-note]").value.trim() || `أُضيف إلى الكتالوگ (${saved.perfume_id}). يمكنك إضافته من «أضف عطراً».`;
        const { error: er } = await sb.from("requests").update({ status: "approved", admin_note: note, perfume_id: saved.perfume_id }).eq("id", r.id);
        if (er) return toast(errText(er), true);
        toast("تم القبول وإضافة العطر ✓"); tabReview();
      }, { name: r.perfume_name, brand: r.brand, size: r.size, price: r.price });
    }
    const st = e.target.dataset && e.target.dataset.st; if (!st) return;
    const li = e.target.closest("li"), note = li.querySelector("[data-note]").value.trim();
    const { error: er } = await sb.from("requests").update({ status: st, admin_note: note }).eq("id", Number(li.dataset.id));
    if (er) return toast(errText(er), true);
    toast(st === "approved" ? "تم القبول ✓" : "تم الرفض"); tabReview();
  });
}

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") viewNewPassword();
  if (event === "SIGNED_IN" && !S.user) start();
});
if (!/type=recovery/.test(location.hash)) start();
