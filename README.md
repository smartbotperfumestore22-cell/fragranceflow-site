# FragranceFlow — الموقع

## التشغيل على حاسوبك (Windows)
1. ثبّت Node.js (نسخة LTS) من https://nodejs.org إذا لم يكن مثبتاً. للتحقق: `node -v`
2. فك ضغط المجلد، ثم افتحه في File Explorer، واضغط بالزر الأيمن داخل المجلد ← Open in Terminal
3. أول مرة فقط: `npm install`
4. لتشغيل الموقع: `npm run dev` ← يفتح المتصفح على http://localhost:5173
   أي تعديل تحفظه يظهر مباشرة في المتصفح. للإيقاف: Ctrl + C

## أين أعدّل؟
| أريد أن أغيّر | الملف |
|---|---|
| نصوص وأقسام الصفحة الرئيسية | `index.html` |
| الألوان والخطوط والتنسيق | `src/site.css` (الألوان في `:root` أعلى الملف) |
| العطور التجريبية | `src/data/perfumes.js` |
| الصور | `public/images/` |
| الإعدادات (الربط بـ Google Sheets، اللغة...) | `src/config.js` |
| الكويز: الأسئلة، المحرك، النتائج | `src/widget/App.jsx` |
| البحث، العطور المشهورة، فتح الكويز | `src/site.js` |

## النشر
- `npm run build` ← ينتج مجلد `dist` جاهزاً للرفع.
- على Vercel: ارفع المجلد إلى GitHub ثم Import في Vercel؛ يتعرف على Vite تلقائياً.
