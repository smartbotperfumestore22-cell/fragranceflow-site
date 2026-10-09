// Runs before every build (npm run build). Reads the perfumes from the FragranceFlow Google Sheet
// through its Apps Script (?action=catalog) and writes src/data/catalog.json for the site.
// It never breaks the build: if the Sheet is not set up, unreachable or looks wrong, it writes null
// and the site keeps its built-in list (src/data/perfumes.js).
import { writeFileSync } from "node:fs";

const OUT = new URL("../src/data/catalog.json", import.meta.url);
// what happened at the last build, readable at <site>/catalog-status.json (no data, no URLs)
const STATUS = new URL("../public/catalog-status.json", import.meta.url);
const BASE = process.env.VITE_FF_SCRIPT_URL || "";
const MIN_PERFUMES = 5; // fewer valid rows than this = something is wrong with the Sheet → keep the built-in list

const GENDERS = ["men", "women", "unisex"];
const WORLDS = ["designer", "niche", "ultra_niche", "arabian"];
const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const str = (v) => String(v ?? "").trim();
const isOff = (v) => ["false", "0", "no", "non", "لا"].includes(str(v).toLowerCase());
const num = (v) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : 0; };

let WARN = [];
function keep(value, why) {
  writeFileSync(OUT, JSON.stringify(value, null, 1) + "\n");
  console.log("[catalog] " + why);
  try {
    writeFileSync(STATUS, JSON.stringify({
      source: Array.isArray(value) ? "sheet" : "built-in list",
      perfumes: Array.isArray(value) ? value.length : null,
      message: why, warnings: WARN.slice(0, 50), built_at: new Date().toISOString(),
    }, null, 1) + "\n");
  } catch (e) {}
}

function build(data) {
  const warn = [];
  const stores = {};
  for (const s of data.stores || []) {
    const id = str(s.store_id);
    if (id && !isOff(s.active)) stores[id] = { name: str(s.name), city: str(s.city) };
  }
  const offers = {};
  for (const o of data.offers || []) {
    const st = stores[str(o.store_id)], pid = str(o.perfume_id), url = str(o.url);
    if (!st || !pid || !/^https?:\/\//i.test(url) || isOff(o.in_stock)) continue;
    (offers[pid] = offers[pid] || []).push({ name: st.name, city: st.city, price: num(o.price) || null, url, size: str(o.size) });
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
  return { perfumes: out, warn };
}

async function main() {
  if (!BASE) return keep(null, "VITE_FF_SCRIPT_URL not set: using the built-in list");
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
    const { perfumes, warn } = build(data);
    WARN = warn;
    warn.forEach((w) => console.warn("[catalog] " + w));
    if (perfumes.length < MIN_PERFUMES) return keep(null, `only ${perfumes.length} valid perfumes in the Sheet: using the built-in list`);
    keep(perfumes, `${perfumes.length} perfumes from the Sheet (${warn.length} warning(s))`);
  } catch (e) {
    keep(null, "could not read the Sheet (" + e.message + "): using the built-in list");
  }
}
main();
