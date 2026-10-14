// Runs before every build (npm run build). Reads the perfumes from the FragranceFlow Google Sheet
// through its Apps Script (?action=catalog) and writes src/data/catalog.json for the site.
// It never breaks the build: if the Sheet is not set up, unreachable or looks wrong, it writes null
// and the site keeps its built-in list (src/data/perfumes.js).
import { writeFileSync } from "node:fs";
import { FF_SCRIPT_URL } from "../src/ff-script-url.js";

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

let WARN = [], POP = null, STORES = null;
function keep(value, why) {
  writeFileSync(OUT, JSON.stringify(value, null, 1) + "\n");
  console.log("[catalog] " + why);
  try {
    writeFileSync(STATUS, JSON.stringify({
      source: Array.isArray(value) ? "sheet" : "built-in list",
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
    const link = (v) => (/^https:\/\//i.test(str(v)) ? str(v) : "");
    stores[id] = { name: str(s.name), city: str(s.city), whatsapp: wa.length >= 9 ? wa : "",
      website: link(s.website || s.website_url), instagram: link(s.instagram || s.instagram_url) };
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
    (offers[pid] = offers[pid] || []).push({ storeId: sid, name: st.name, city: st.city, price: num(o.price) || null, size: str(o.size),
      url, page, whatsapp });
  }
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

async function main() {
  if (!BASE) return keep(null, "no Sheet script URL: using the built-in list");
  try {
    const res = await fetch(BASE + (BASE.includes("?") ? "&" : "?") + "action=catalog", { redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return keep(null, `Sheet answered ${res.status}: using the built-in list`);
    const body = await res.text();
    let data;
    try { data = JSON.parse(body); }
    catch (e) {
      const login = /accounts\.google\.com|ServiceLogin|<html/i.test(body);
      return keep(null, login
        ? "the Sheet script asked for a Google login: in Apps Script, the deployment must have Who has access = Anyone (Tout le monde)"
        : "the Sheet script did not answer with data (check the /exec URL and that ?action=catalog shows the perfumes)");
    }
    if (!data || !Array.isArray(data.perfumes)) return keep(null, "the Sheet script answered without a perfumes list (is the code pasted and deployed as a new version?)");
    const { perfumes, warn, popInfo, storeInfo } = build(data);
    WARN = warn; POP = popInfo; STORES = storeInfo;
    warn.forEach((w) => console.warn("[catalog] " + w));
    if (perfumes.length < MIN_PERFUMES) return keep(null, `only ${perfumes.length} valid perfumes in the Sheet: using the built-in list`);
    keep(perfumes, `${perfumes.length} perfumes from the Sheet (${warn.length} warning(s))`);
  } catch (e) {
    keep(null, "could not read the Sheet (" + e.message + "): using the built-in list");
  }
}
main();
