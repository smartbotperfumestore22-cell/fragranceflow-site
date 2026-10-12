// Store link: <site>/?store=<store_id>
// The whole visit shows only the fragrances that store has in stock (Offers tab), at the store's price, with its
// buy link. The quiz and the engine are unchanged: they simply run on this smaller catalogue.
// An unknown store, or a store without offers, leaves the site in its normal, neutral mode.

export function storeIdFromUrl() {
  try {
    const id = new URLSearchParams(window.location.search).get("store");
    return id && /^[\w-]{1,60}$/.test(id) ? id.toLowerCase() : "";
  } catch (e) { return ""; }
}

// WhatsApp links get a ready message naming the perfume
function withMessage(url, name) {
  if (!/^https:\/\/wa\.me\/\d+$/.test(url)) return url;
  return url + "?text=" + encodeURIComponent(`السلام عليكم، شفت ${name} ف FragranceFlow. واش متوفر عندكم؟`);
}

// returns { db, store } — db is the catalogue to use, store is null in normal mode
export function applyStoreMode(db) {
  const all = db.map((p) => (p.stores && p.stores.length ? { ...p, stores: p.stores.map((s) => ({ ...s, url: withMessage(s.url, p.name) })) } : p));
  const id = storeIdFromUrl();
  if (!id) return { db: all, store: null };
  const mine = [];
  let store = null;
  for (const p of all) {
    const offer = (p.stores || []).find((s) => s.storeId === id);
    if (!offer) continue;
    store = store || { id, name: offer.name, city: offer.city };
    // the store's own price and link; "where to buy" lists only this store
    mine.push({ ...p, price: offer.price || p.price, stores: [offer] });
  }
  if (!mine.length) return { db: all, store: null };
  return { db: mine, store };
}
