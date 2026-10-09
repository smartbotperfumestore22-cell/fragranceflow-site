// ─────────────────────────────────────────────────────────────
//  FragranceFlow — إعدادات الموقع
// ─────────────────────────────────────────────────────────────
//  للتجربة: اترك SHEETS_API_URL فارغاً، فيستعمل الموقع العطور الـ 41 الموجودة في src/data/perfumes.js
//  للربط بالقاعدة الحقيقية: ضع رابط Apps Script و STORE_KEY، فيجلب الكويز العطور من Master Database
import { IMG } from "./data/images.js";
import { buildCatalog } from "./data/perfumes.js";
import SHEET from "./data/catalog.json"; // written at build time from the Google Sheet (scripts/fetch-catalog.mjs); null = not set up

window.__FF_CONFIG__ = {
  STORE_NAME: "FragranceFlow",
  STORE_ID: "",
  STORE_KEY: "",
  SHEETS_API_URL: "",
  // التحليلات (👍/👎، المشاركة، الشراء...) كتمشي لـ Apps Script ديال الـ Google Sheet (apps-script/fragranceflow.gs).
  // الرابط كيتحط ف Vercel → Settings → Environment Variables باسم VITE_FF_SCRIPT_URL، وهو نفسو لي كيجيب منو الموقع العطور فاش كيتبنى.
  ANALYTICS_URL: import.meta.env.VITE_FF_SCRIPT_URL || import.meta.env.VITE_ANALYTICS_URL || "",
  DEFAULT_LANGUAGE: "ar",
  CURRENCY: "درهم",
  HAS_DECANT: false,
  HAS_FULL: true,
  DEFAULT_SIZE: "full",
  PAGE_MODE: true,     // الكويز صفحة من الموقع، ماشي نافذة
  HIDE_TRIGGER: true,  // بلا الزر العائم ديال الويدجت
  MARKETPLACE: true,   // زر الشراء كيدي لموقع المحل الشريك، بلا واتساب
};

// visit attribution for analytics: where the visitor came from (a shared link carries utm_source), kept for this tab only
try {
  const utm = new URLSearchParams(window.location.search).get("utm_source");
  if (utm && /^[\w.-]{1,40}$/.test(utm)) sessionStorage.setItem("ff_utm", utm);
} catch (e) {}

if (!window.__FF_CONFIG__.SHEETS_API_URL) {
  // perfumes from the Google Sheet when the build could read it, otherwise the built-in list
  window.__ffDP__ = Array.isArray(SHEET) && SHEET.length
    ? SHEET.map(({ imageKey, imageUrl, ...p }) => ({ ...p, image: imageUrl || IMG[imageKey] || IMG.c2 }))
    : buildCatalog(IMG);
}
