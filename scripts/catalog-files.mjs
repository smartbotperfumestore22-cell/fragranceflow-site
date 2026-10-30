// The catalogue, cut into small files the visitor loads at run time instead of one big file inside the code:
//   catalog/all.json        perfumes that at least one store sells (the site without a store)
//   catalog/s/<store>.json  only that store's perfumes, with only its own offer (a store link: 500 perfumes at most)
// Read from src/data/catalog.json (written by scripts/fetch-catalog.mjs before the build).
import { readFileSync } from "node:fs";

const SRC = new URL("../src/data/catalog.json", import.meta.url);
const ID = /^[\w-]{1,60}$/;

export function catalogFiles() {
  let db;
  try { db = JSON.parse(readFileSync(SRC, "utf8")); } catch (e) { return {}; }
  if (!Array.isArray(db) || !db.length) return {};
  const sold = db.filter((p) => (p.stores || []).length);
  const files = { "catalog/all.json": sold.length ? sold : db };
  const byStore = {};
  for (const p of db) for (const o of p.stores || []) {
    const id = String(o.storeId || "").toLowerCase();
    if (!ID.test(id)) continue;
    (byStore[id] = byStore[id] || []).push({ ...p, stores: [o] });
  }
  for (const id in byStore) files[`catalog/s/${id}.json`] = byStore[id];
  return files;
}

// Vite: written next to the site at build time, served from memory by the dev server
export function catalogPlugin() {
  return {
    name: "ff-catalog-files",
    generateBundle() {
      for (const [fileName, data] of Object.entries(catalogFiles())) this.emitFile({ type: "asset", fileName, source: JSON.stringify(data) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0].replace(/^\//, "");
        if (!path.startsWith("catalog/")) return next();
        const data = catalogFiles()[path];
        if (!data) { res.statusCode = 404; return res.end(); }
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data));
      });
    },
  };
}
