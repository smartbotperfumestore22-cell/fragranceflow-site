// Runs before every build (npm run build). Reads perfumes, stores and offers from Supabase (the merchant portal
// writes there) and the popularity scores from the Google Sheet's Apps Script (?action=catalog), then writes
// src/data/catalog.json for the site. If Supabase cannot be read, it falls back to the Sheet as before.
// It never breaks the build: if the Sheet is not set up, unreachable or looks wrong, it writes null
// and the site keeps its built-in list (src/data/perfumes.js).
import { writeFileSync } from "node:fs";
import { FF_SCRIPT_URL } from "../src/ff-script-url.js";
import { SUPABASE_URL, SUPABASE_KEY } from "../src/supabase-config.js";

const OUT = new URL("../src/data/catalog.json", import.meta.url);
// what happened at the last build, readable at <site>/catalog-status.json (no data, no URLs)
const STATUS = new URL("../public/catalog-status.json", import.meta.url);
const BASE = process.env.VITE_FF_SCRIPT_URL || FF_SCRIPT_URL || "";
const MIN_PERFUMES = 5; // fewer valid rows than this = something is wrong with the Sheet → keep the built-in list
// "most looked-for" needs real activity before it replaces the default selection on the homepage
const POP_MIN_INTERACTIONS = 20, POP_MIN_PERFUMES = 4;

const GENDERS = ["men", "women", "unisex"];
const WORLDS = ["designer", "niche", "ultra_niche", "arabian"];
const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const str = (v) => String(v ?? "").trim();
const isOff = (v) => ["false", "0", "no", "non", "لا"].includes(str(v).toLowerCase());
const num = (v) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : 0; };

let WARN = [], POP = null, STORES = null, SOURCE = "sheet", COMPARE = null;
// Offers → size_type: "full", "decant" or "both" (Arabic / French words accepted). Empty = not said (nothing shown); null = not understood.
function offerFormat(v) {
  const t = str(v).toLowerCase();
  if (!t) return [];
  if (/both|deux|بجوج|جوج|الإثنين|الاثنين|كلاهما/.test(t)) return ["full", "decant"];
  const out = [];
  if (/full|flacon|bouteille|bottle|كامل|قنينة|قارورة|زجاجة/.test(t)) out.push("full");
  if (/d[ée]cant|ديك|ديكونط|ديكانت/.test(t)) out.push("decant");
  return out.length ? out : null;
}
function keep(value, why) {
  writeFileSync(OUT, JSON.stringify(value, null, 1) + "\n");
  console.log("[catalog] " + why);
  try {
    writeFileSync(STATUS, JSON.stringify({
      source: Array.isArray(value) ? SOURCE : "built-in list", compare_with_sheet: COMPARE,
      perfumes: Array.isArray(value) ? value.length : null,
      message: why, stores: STORES, popular: POP, warnings: WARN.slice(0, 50), built_at: new Date().toISOString(),
    }, null, 1) + "\n");
  } catch (e) {}
}

function build(data) {
  const warn = [];
  const stores = {};
  for (const s of data.stores || []) {
    const id = str(s.store_id).toLowerCase();
    if (!id || isOff(s.active)) continue;
    // WhatsApp number: digits only; a Moroccan local number (06…, 07…) gets the country code 212
    let wa = str(s.whatsapp).replace(/\D/g, "").replace(/^00/, "");
    if (/^0[5-7]\d{8}$/.test(wa)) wa = "212" + wa.slice(1);
    // Google Sheets drops the leading 0 of a number typed as 0654091373 → 654091373: same Moroccan mobile number
    else if (/^[5-7]\d{8}$/.test(wa)) wa = "212" + wa;
    const link = (v) => (/^https:\/\//i.test(str(v)) ? str(v) : "");
    // optional branding for the store link: logo (https image) and one accent colour (#rrggbb)
    const color = /^#?[0-9a-f]{6}$/i.test(str(s.color)) ? "#" + str(s.color).replace(/^#/, "").toLowerCase() : "";
    stores[id] = { name: str(s.name), city: str(s.city), whatsapp: wa.length >= 9 ? wa : "",
      website: link(s.website || s.website_url), instagram: link(s.instagram || s.instagram_url),
      logo: link(s.logo_url || s.logo), color,
      welcomeTitle: str(s.welcome_title).slice(0, 80), welcomeText: str(s.welcome_text).slice(0, 300), cover: link(s.cover_url) };
  }
  const offers = {};
  for (const o of data.offers || []) {
    const sid = str(o.store_id).toLowerCase(), st = stores[sid], pid = str(o.perfume_id);
    if (!st || !pid || isOff(o.in_stock)) continue;   // only offers in stock, from active stores
    const productUrl = /^https?:\/\//i.test(str(o.url)) ? str(o.url) : "";
    const whatsapp = st.whatsapp ? "https://wa.me/" + st.whatsapp : "";
    // the store's name links to: the product page, else the store's website, else its Instagram
    const page = productUrl || st.website || st.instagram;
    // main link kept for older parts of the site: product page, else WhatsApp (as before)
    const url = productUrl || whatsapp;
    if (!page && !whatsapp) continue; // no way to reach the store
    // what the store sells for this fragrance (Offers → size_type): full bottle, decant, or both
    const fmtRaw = [o.size_type, o.format, o.type].map(str).find(Boolean) || "";
    const fmt = offerFormat(fmtRaw);
    if (fmt === null) warn.push(`Offers: size_type "${fmtRaw}" for ${pid} / ${sid} not understood (use full, decant or both)`);
    const list = (offers[pid] = offers[pid] || []);
    const same = list.find((x) => x.storeId === sid);
    if (same) { // the same store on two rows (e.g. one full, one decant): one store, both formats
      (fmt || []).forEach((f) => { if (!same.formats.includes(f)) same.formats.push(f); });
      if (!same.page && page) same.page = page;
      continue;
    }
    // every size the store sells with its price (decants 5ml, 10ml… and full bottles), cheapest first
    const variants = Array.isArray(o.variants) ? o.variants.filter((v) => v && v.size && num(v.price))
      .map((v) => ({ type: v.type === "decant" ? "decant" : "full", size: str(v.size), price: num(v.price) })) : [];
    list.push({ storeId: sid, name: st.name, city: st.city, price: num(o.price) || null, size: str(o.size), variants,
      url, page, whatsapp, formats: fmt || [],
      // the store's own details, for the store link (header, footer)
      storeWebsite: st.website, storeInstagram: st.instagram, storeLogo: st.logo, storeColor: st.color,
      storeWelcomeTitle: st.welcomeTitle, storeWelcomeText: st.welcomeText, storeCover: st.cover });
  }
  for (const pid in offers) offers[pid].forEach((x) => x.formats.sort((a, b) => (a === "full" ? -1 : b === "full" ? 1 : 0)));
  const seen = new Set(), out = [];
  (data.perfumes || []).forEach((p, i) => {
    const row = i + 2, id = str(p.perfume_id), name = str(p.name), brand = str(p.brand), gender = str(p.gender).toLowerCase();
    if (!id && !name) return; // empty row
    if (!id || !name || !brand) return warn.push(`row ${row}: perfume_id, name and brand are required`);
    if (seen.has(id)) return warn.push(`row ${row}: duplicate perfume_id ${id} (skipped)`);
    seen.add(id);
    if (isOff(p.active)) return;
    if (!GENDERS.includes(gender)) return warn.push(`row ${row} (${id}): gender must be men, women or unisex`);
    const world = str(p.world).toLowerCase().replace(/[\s-]+/g, "_");
    if (world && !WORLDS.includes(world)) warn.push(`row ${row} (${id}): unknown world "${p.world}" (left unclassified)`);
    out.push({
      id, name, brand, gender: [gender],
      character: list(p.character), occasion: list(p.occasion), season: list(p.season),
      price: num(p.ref_price), size: str(p.size), sizeType: str(p.size_type).toLowerCase() === "decant" ? "decant" : "full",
      concentration: str(p.concentration),
      notes: { top: list(p.notes_top), middle: list(p.notes_mid), base: list(p.notes_base) },
      imageKey: str(p.image_key), imageUrl: /^https?:\/\//i.test(str(p.image_url)) ? str(p.image_url) : "",
      world: WORLDS.includes(world) ? world : "",
      stores: (offers[id] || []).sort((a, b) => (a.price || 1e9) - (b.price || 1e9)),
      url: "", store: "", active: true, boost: 0,
    });
  });
  // popularity: score from the Sheet (views, searches, favourites, buy clicks), matched by perfume_id, else by name
  const pop = data.popular || {}, scores = {};
  for (const it of pop.items || []) {
    const p = out.find((x) => (it.pid && x.id === str(it.pid)) || (!it.pid && x.name.toLowerCase() === str(it.perfume).toLowerCase()));
    if (p) scores[p.id] = (scores[p.id] || 0) + (Number(it.score) || 0);
  }
  const ranked = Object.keys(scores).filter((k) => scores[k] > 0);
  const enough = (Number(pop.interactions) || 0) >= POP_MIN_INTERACTIONS && ranked.length >= POP_MIN_PERFUMES;
  if (enough) out.forEach((p) => { if (scores[p.id]) p.pop = scores[p.id]; });
  const popInfo = { interactions: Number(pop.interactions) || 0, perfumes_with_activity: ranked.length, used: enough,
    note: enough ? "homepage shows the most looked-for perfumes" : `homepage keeps its default selection until ${POP_MIN_INTERACTIONS} interactions on ${POP_MIN_PERFUMES}+ perfumes (last ${pop.days || 30} days)` };
  // store links available after this build (ids are public anyway: they are in the links)
  const storeInfo = Object.keys(stores).map((id) => ({ id, name: stores[id].name,
    offers: out.filter((p) => (p.stores || []).some((o) => o.storeId === id)).length,
    link: "?store=" + id + "#quiz" }));
  for (const o of data.offers || []) {
    const sid = str(o.store_id).toLowerCase();
    if (sid && !stores[sid]) warn.push(`Offers: store_id "${o.store_id}" is not an active store in Stores (offer ignored)`);
    else if (str(o.perfume_id) && !out.some((p) => p.id === str(o.perfume_id))) warn.push(`Offers: perfume_id "${o.perfume_id}" is not in Perfumes (offer ignored)`);
  }
  return { perfumes: out, warn, popInfo, storeInfo };
}

// Supabase: only what the public may read (row-level security): active perfumes, live stores, their active offers
async function sbAll(table, select, order) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=${order}`, {
      headers: { apikey: SUPABASE_KEY, Range: `${from}-${from + 999}`, "Range-Unit": "items" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${table}: ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function readSupabase() {
  const [perfumes, stores, offers] = await Promise.all([
    sbAll("perfumes", "*", "perfume_id"),
    // welcome text and cover of the store's quiz page (010_store_page.sql); older databases without them still work
    sbAll("stores", "id,name,city,website,whatsapp,instagram,logo_url,color,active,welcome_title,welcome_text,cover_url", "id")
      .catch(() => sbAll("stores", "id,name,city,website,whatsapp,instagram,logo_url,color,active", "id")),
    // sizes per offer (008_offer_sizes.sql); older databases without the column still work
    sbAll("offers", "store_id,perfume_id,size,size_type,price,url,in_stock,variants", "id")
      .catch(() => sbAll("offers", "store_id,perfume_id,size,size_type,price,url,in_stock", "id")),
  ]);
  return { perfumes, stores: stores.map((s) => ({ ...s, store_id: s.id })), offers };
}
async function readSheet() {
  const res = await fetch(BASE + (BASE.includes("?") ? "&" : "?") + "action=catalog", { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Sheet answered ${res.status}`);
  const body = await res.text();
  try { return JSON.parse(body); }
  catch (e) {
    throw new Error(/accounts\.google\.com|ServiceLogin|<html/i.test(body)
      ? "the Sheet script asked for a Google login: in Apps Script, the deployment must have Who has access = Anyone (Tout le monde)"
      : "the Sheet script did not answer with data (check the /exec URL and that ?action=catalog shows the perfumes)");
  }
}
// while moving to Supabase: say whether the quiz would get the same perfumes and offers as from the Sheet
function compare(a, b) {
  const key = (p) => JSON.stringify({ ...p, pop: undefined, stores: (p.stores || []).map((o) => [o.storeId, o.price, o.size, o.formats.join("+"), o.url]) });
  const A = new Map(a.map((p) => [p.id, key(p)])), B = new Map(b.map((p) => [p.id, key(p)]));
  const diff = [...new Set([...A.keys(), ...B.keys()])].filter((id) => A.get(id) !== B.get(id));
  return { same: diff.length === 0, sheet_perfumes: a.length, supabase_perfumes: b.length, different: diff.slice(0, 20) };
}

async function main() {
  let sheet = null, sheetErr = "";
  if (BASE) { try { sheet = await readSheet(); } catch (e) { sheetErr = e.message; } }
  let data = null;
  try {
    const sb = await readSupabase();
    // "most looked-for" from Supabase's events (Phase 3); the Sheet's only if Supabase cannot answer
    let popular = (sheet && sheet.popular) || {};
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/popular_items`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_days: 30 }), signal: AbortSignal.timeout(20000) });
      if (res.ok) { const p = await res.json(); if (p && Array.isArray(p.items)) popular = p; }
    } catch (e) { /* keep the Sheet's */ }
    if (sb.perfumes.length >= MIN_PERFUMES) { data = { ...sb, popular }; SOURCE = "supabase"; }
    else console.warn(`[catalog] Supabase has only ${sb.perfumes.length} perfumes: using the Sheet`);
  } catch (e) { console.warn("[catalog] could not read Supabase (" + e.message + "): using the Sheet"); }
  if (!data) {
    if (!BASE) return keep(null, "no Supabase and no Sheet script URL: using the built-in list");
    if (!sheet) return keep(null, "could not read the Sheet (" + sheetErr + "): using the built-in list");
    data = sheet; SOURCE = "sheet";
  }
  try {
    if (!data || !Array.isArray(data.perfumes)) return keep(null, "the Sheet script answered without a perfumes list (is the code pasted and deployed as a new version?)");
    const { perfumes, warn, popInfo, storeInfo } = build(data);
    WARN = warn; POP = popInfo; STORES = storeInfo;
    if (SOURCE === "supabase" && sheet && Array.isArray(sheet.perfumes)) {
      try { COMPARE = compare(build(sheet).perfumes, perfumes); console.log("[catalog] compared with the Sheet: " + JSON.stringify(COMPARE)); } catch (e) {}
    }
    warn.forEach((w) => console.warn("[catalog] " + w));
    if (perfumes.length < MIN_PERFUMES) return keep(null, `only ${perfumes.length} valid perfumes: using the built-in list`);
    keep(perfumes, `${perfumes.length} perfumes from ${SOURCE === "supabase" ? "Supabase" : "the Sheet"} (${warn.length} warning(s))`);
  } catch (e) {
    keep(null, "could not build the catalogue (" + e.message + "): using the built-in list");
  }
}
main();
