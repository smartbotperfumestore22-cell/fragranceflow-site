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

// WhatsApp links get a ready message naming the perfume. Through a store link, the message speaks of
// the store's own quiz (the visitor never left the store's experience).
function withMessage(url, name, inStore) {
  if (!/^https:\/\/wa\.me\/\d+$/.test(url)) return url;
  const text = inStore === "demo"
    ? `السلام عليكم، جربت الديمو ديال FragranceFlow وطلع ليا ${name}. بغيت نعرف أكثر على الخدمة للمتجر ديالي.`
    : inStore
    ? `السلام عليكم، دوزت اختبار العطور ديالكم وطلع ليا ${name}. واش متوفر عندكم؟`
    : `السلام عليكم، شفت ${name} ف FragranceFlow. واش متوفر عندكم؟`;
  return url + "?text=" + encodeURIComponent(text);
}

// returns { db, store } — db is the catalogue to use, store is null in normal mode
export function applyStoreMode(db) {
  const id = storeIdFromUrl();
  const inStore = !!id && db.some((p) => (p.stores || []).some((s) => s.storeId === id));
  const all = db.map((p) => (p.stores && p.stores.length
    ? { ...p, stores: p.stores.map((s) => ({ ...s, url: withMessage(s.url, p.name, inStore && id === "demo" ? "demo" : inStore), whatsapp: s.whatsapp ? withMessage(s.whatsapp, p.name, inStore && id === "demo" ? "demo" : inStore) : "" })) }
    : p));
  if (!id) return { db: all, store: null };
  const mine = [];
  let store = null;
  for (const p of all) {
    const offer = (p.stores || []).find((s) => s.storeId === id);
    if (!offer) continue;
    store = store || { id, name: offer.name, city: offer.city, website: offer.storeWebsite || "", instagram: offer.storeInstagram || "",
      logo: offer.storeLogo || "", color: offer.storeColor || "",
      whatsapp: /^https:\/\/wa\.me\/\d+/.test(offer.whatsapp || "") ? offer.whatsapp.split("?")[0] : "" };
    // the store's own price and link; "where to buy" lists only this store
    mine.push({ ...p, price: offer.price || p.price, stores: [offer] });
  }
  if (!mine.length) return { db: all, store: null };
  store.count = mine.filter((p) => p.active !== false).length;
  return { db: mine, store };
}
