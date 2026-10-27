// Merchant portal: /portal/ — sign in (accounts are created by FragranceFlow, no public sign-up),
// then the merchant manages its own offers (price, stock, remove/restore, add from the catalogue) and sends requests
// for perfumes that are not in the catalogue yet. Every rule is enforced again by Supabase row-level security.
import "./dashboard.css";
import "./portal.css";
import { sb } from "./supabase.js";
import { esc, fmt } from "./dash-common.js";

const app = document.getElementById("app");
const userBox = document.getElementById("p-user");
const S = { user: null, admin: false, stores: [], store: null, tab: "offers", offers: [], catalog: null, requests: [], q: "", flash: "" };
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
  if (!S.stores.length) { app.innerHTML = '<section class="d-card p-auth"><h1>ما لقينا حتى متجر مربوط بهاد الحساب</h1><p class="p-sub">تواصل مع FragranceFlow باش يربطو الحساب ديالك بالمتجر.</p></section>'; return; }
  const saved = sessionStorage.getItem("ff_store");
  S.store = S.stores.find((s) => s.id === saved) || S.stores[0];
  if (S.admin && !saved) S.tab = "review";
  await loadStore();
}

async function loadStore() {
  sessionStorage.setItem("ff_store", S.store.id);
  const [o, r] = await Promise.all([
    sb.from("offers").select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, perfumes(name, brand, gender, image_url)").eq("store_id", S.store.id),
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
  const s = S.store, live = S.offers.filter((o) => o.active), off = live.filter((o) => !o.in_stock).length;
  const pending = S.requests.filter((r) => r.status === "pending").length;
  const tabs = [["offers", `عطوري <small>${live.length}</small>`], ["add", "زيد عطر"], ["requests", `طلب عطر جديد${pending ? ` <small>${pending}</small>` : ""}`]];
  if (S.admin) tabs.push(["review", "مراجعة الطلبات"]);
  app.innerHTML = `
    <section class="d-head p-head">
      <span class="d-seal" style="${s.color ? "background:" + esc(s.color) : ""}">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : esc(s.name.slice(0, 2).toUpperCase())}</span>
      <div><h1>${esc(s.name)}</h1><p>${fmt(live.length)} عطر · ${fmt(off)} مقطوع</p></div>
      ${S.stores.length > 1 ? `<label class="p-pick">المتجر<select id="s-store">${S.stores.map((x) => `<option value="${esc(x.id)}"${x.id === s.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    </section>
    ${trialBanner(s)}
    <nav class="p-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</nav>
    <section id="tab" class="d-card p-panel"></section>
    <p class="d-foot">التبديلات كتبان للزبناء فالكويز من بعد التحديث ديال الموقع (مرة فالنهار).</p>`;
  app.querySelectorAll(".p-tabs button").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; S.q = ""; render(); }));
  const pick = document.getElementById("s-store");
  if (pick) pick.addEventListener("change", () => { S.store = S.stores.find((x) => x.id === pick.value); loadStore(); });
  ({ offers: tabOffers, add: tabAdd, requests: tabRequests, review: tabReview }[S.tab] || tabOffers)();
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
      <div class="p-name"><b dir="ltr">${esc(o.perfumes?.name || o.perfume_id)}</b><small dir="ltr">${esc(o.perfumes?.brand || "")}${o.size ? " · " + esc(o.size) : ""}</small></div>
      ${o.active ? `<label class="p-price"><span class="sr">الثمن</span><input type="number" inputmode="decimal" min="0" step="1" value="${o.price ?? ""}" data-act="price"><em>درهم</em></label>
        <label class="p-switch"><input type="checkbox" data-act="stock"${o.in_stock ? " checked" : ""}><span>${o.in_stock ? "متوفر" : "مقطوع"}</span></label>
        <button type="button" class="p-icon" data-act="remove" aria-label="حيد ${esc(o.perfumes?.name || "")}" title="حيد">✕</button>`
      : `<span class="p-tag">محيد</span><button type="button" class="p-link" data-act="restore">رجعو</button>`}
    </li>`).join("");
  };
  draw(); wireSearch(draw);
  el.addEventListener("change", async (e) => {
    const li = e.target.closest(".p-item"); if (!li) return;
    const o = S.offers.find((x) => x.id === Number(li.dataset.id));
    if (e.target.dataset.act === "price") {
      const v = e.target.value === "" ? null : Number(e.target.value);
      if (v != null && (isNaN(v) || v < 0 || v > 100000)) { toast("الثمن ماشي صحيح.", true); e.target.value = o.price ?? ""; return; }
      await save(o, { price: v }, "تبدل الثمن ✓");
    }
    if (e.target.dataset.act === "stock") { await save(o, { in_stock: e.target.checked }, e.target.checked ? "ولا متوفر ✓" : "ولا مقطوع ✓"); render(); }
  });
  el.addEventListener("click", async (e) => {
    const act = e.target.dataset && e.target.dataset.act; if (act !== "remove" && act !== "restore") return;
    const o = S.offers.find((x) => x.id === Number(e.target.closest(".p-item").dataset.id));
    await save(o, { active: act === "restore" }, act === "restore" ? "رجع العطر ✓" : "تحيد العطر. تقدر ترجعو من بعد.");
    render();
  });
}

async function save(o, patch, ok) {
  const { data, error } = await sb.from("offers").update(patch).eq("id", o.id).select("id, price, in_stock, active, updated_at").single();
  if (error) { toast(errText(error), true); return false; }
  Object.assign(o, data); toast(ok); return true;
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
      return `<li class="p-item" data-pid="${esc(p.perfume_id)}">${thumb(p)}
        <div class="p-name"><b dir="ltr">${esc(p.name)}</b><small dir="ltr">${esc(p.brand)} · ${GENDER[p.gender] || ""}</small></div>
        ${have && have.active ? '<span class="p-tag is-ok">عندك</span>'
          : `<label class="p-price"><span class="sr">الثمن</span><input type="number" inputmode="decimal" min="0" step="1" placeholder="الثمن" data-act="newprice"><em>درهم</em></label>
             <button type="button" class="d-btn p-add" data-act="add">${have ? "رجعو" : "زيد"}</button>`}</li>`;
    }).join("") : '<li class="d-empty">ما لقينا والو بهاد الاسم.</li>';
  };
  draw(); wireSearch(draw);
  el.addEventListener("click", async (e) => {
    if (!e.target.dataset || e.target.dataset.act !== "add") return;
    const li = e.target.closest(".p-item"), pid = li.dataset.pid, pin = li.querySelector("[data-act=newprice]");
    const price = pin.value === "" ? null : Number(pin.value);
    if (price == null || isNaN(price) || price <= 0) { toast("كتب الثمن قبل.", true); pin.focus(); return; }
    e.target.disabled = true;
    const have = mine[pid];
    if (have) { if (await save(have, { active: true, in_stock: true, price }, "رجع العطر ✓")) draw(); e.target.disabled = false; return; }
    const p = cat.find((x) => x.perfume_id === pid);
    const { data, error } = await sb.from("offers").insert({ store_id: S.store.id, perfume_id: pid, price, size: p.size || "", in_stock: true })
      .select("id, perfume_id, size, size_type, price, in_stock, active, updated_at, perfumes(name, brand, gender, image_url)").single();
    e.target.disabled = false;
    if (error) return toast(errText(error), true);
    S.offers.push(data); mine[pid] = data; toast(`تزاد ${p.name} ✓`); draw();
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
        <button type="button" class="d-btn" data-st="approved">قبول</button><button type="button" class="p-link" data-st="rejected">رفض</button></div>`
        : `<span class="p-tag is-${r.status}">${STATUS[r.status]}</span>`}</li>`;
  el.innerHTML = `<h2 class="p-h2">كيتسناو (${pend.length})</h2>${pend.length ? `<ul class="p-reqs">${pend.map(row).join("")}</ul>` : '<p class="d-empty">ما كاين حتى طلب كيتسنى ✅</p>'}
    <p class="p-small">ملي تقبل طلب: زيد العطر ف Perfumes بالتصنيف ديالو، ومن بعد التاجر يقدر يزيدو من «زيد عطر».</p>
    ${done.length ? `<h2 class="p-h2">آخر الطلبات اللي تراجعو</h2><ul class="p-reqs">${done.map(row).join("")}</ul>` : ""}`;
  el.addEventListener("click", async (e) => {
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
