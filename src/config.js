// ─────────────────────────────────────────────────────────────
//  FragranceFlow — إعدادات الموقع
// ─────────────────────────────────────────────────────────────
//  للتجربة: اترك SHEETS_API_URL فارغاً، فيستعمل الموقع العطور الـ 41 الموجودة في src/data/perfumes.js
//  للربط بالقاعدة الحقيقية: ضع رابط Apps Script و STORE_KEY، فيجلب الكويز العطور من Master Database
import { IMG } from "./data/images.js";
import { buildCatalog } from "./data/perfumes.js";

window.__FF_CONFIG__ = {
  STORE_NAME: "FragranceFlow",
  STORE_ID: "",
  STORE_KEY: "",
  SHEETS_API_URL: "",
  DEFAULT_LANGUAGE: "ar",
  CURRENCY: "درهم",
  HAS_DECANT: false,
  HAS_FULL: true,
  DEFAULT_SIZE: "full",
  PAGE_MODE: true,     // الكويز صفحة من الموقع، ماشي نافذة
  HIDE_TRIGGER: true,  // بلا الزر العائم ديال الويدجت
  MARKETPLACE: true,   // زر الشراء كيدي لموقع المحل الشريك، بلا واتساب
};

if (!window.__FF_CONFIG__.SHEETS_API_URL) {
  window.__ffDP__ = buildCatalog(IMG);
}
