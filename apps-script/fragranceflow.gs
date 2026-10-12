/**
 * FragranceFlow — Google Sheet ↔ website
 *
 * One script, bound to the FragranceFlow Sheet (tabs: Perfumes, Stores, Offers, Events).
 *   • ?action=catalog   → the website reads Perfumes / Stores / Offers when it is built
 *   • ?action=analytics → the website records an event in the Events tab
 *     (never send a parameter named "sid" or "c": Apps Script reserves them and answers 400)
 *   • Menu "FragranceFlow" → "Check data" and "Publish the site" (rebuilds the site on Vercel)
 *   • Menu "FragranceFlow" → Cloudinary: fills Perfumes.image_url with the delivery URL of each photo found in
 *     Cloudinary under fragranceflow/perfumes/<brand>/<perfume>. The API secret stays in this script's
 *     properties (never in the Sheet, never on the website).
 *
 * Setup: see the Guide tab or the steps you received. In short:
 *   1. Extensions → Apps Script → paste this file → Save.
 *   2. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → copy the /exec URL.
 *   3. Vercel → Settings → Environment Variables: VITE_FF_SCRIPT_URL = that URL (Production + Preview).
 *   4. Vercel → Settings → Git → Deploy Hooks → create one for branch "main" → copy its URL.
 *      Back in the Sheet: menu FragranceFlow → "Publish the site" asks for it the first time.
 * After editing this script: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy,
 * so the same /exec URL keeps working.
 */

var TAB = { perfumes: 'Perfumes', stores: 'Stores', offers: 'Offers', events: 'Events' };
var GENDERS = ['men', 'women', 'unisex'];
var WORLDS = ['designer', 'niche', 'ultra_niche', 'arabian'];
var EVENTS = [
  'widget_open', 'quiz_complete', 'result_shown', 'persona_feedback', 'favorite_pick',
  'buy_click', 'whatsapp_click', 'lost_sale',
  'personality_share_click', 'personality_share_whatsapp', 'personality_share_facebook',
  'personality_share_instagram', 'personality_share_copy',
  'perfume_view', 'search_pick'
];
// "most looked-for" score per fragrance, over the last POP_DAYS days of the Events tab
var POP_DAYS = 30;
var POP_WEIGHTS = { perfume_view: 1, search_pick: 2, favorite_pick: 3, buy_click: 4 };
var EVENT_HEADER = ['Time', 'Event', 'Session', 'Source', 'Perfume / answer', 'Character', 'Impression', 'Details'];
var EVENT_SKIP = ['action', 'store', 'key', 'event', 'visit', 'utm', 'perfume', 'character', 'impression'];

/* ---------------- web endpoints ---------------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'catalog') return json_(catalog_());
  if (p.action === 'analytics') return text_(recordEvent_(p));
  return text_('FragranceFlow');
}

// rows of a tab as objects keyed by the header row
function rows_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var head = values.shift().map(function (h) { return String(h).trim(); });
  return values.map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : r[i]; });
    return o;
  });
}

function catalog_() {
  return { perfumes: rows_(TAB.perfumes), stores: rows_(TAB.stores), offers: rows_(TAB.offers), popular: popular_(), at: new Date().toISOString() };
}

// counts only — never the raw events — so nothing about visitors leaves the Sheet
function popular_() {
  var since = Date.now() - POP_DAYS * 864e5, by = {}, total = 0;
  rows_(TAB.events).forEach(function (e) {
    var w = POP_WEIGHTS[e.Event];
    var t = e.Time instanceof Date ? e.Time.getTime() : Date.parse(e.Time);
    if (!w || !(t >= since)) return;
    var pid = '', name = String(e['Perfume / answer'] || '').trim();
    try { pid = String((JSON.parse(e.Details || '{}') || {}).pid || ''); } catch (x) {}
    var key = pid || name;
    if (!key) return;
    var v = by[key] = by[key] || { pid: pid, perfume: name, score: 0, n: 0 };
    v.score += w; v.n += 1; total += 1;
  });
  var items = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 30);
  return { days: POP_DAYS, interactions: total, items: items };
}

function recordEvent_(p) {
  if (EVENTS.indexOf(p.event) === -1) return 'ignored';
  var details = {};
  Object.keys(p).forEach(function (k) { if (EVENT_SKIP.indexOf(k) === -1) details[clip_(k, 40)] = clip_(p[k], 200); });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB.events);
    if (!sh) { sh = ss.insertSheet(TAB.events); sh.appendRow(EVENT_HEADER); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), p.event, clip_(p.visit, 20), clip_(p.utm, 40), clip_(p.perfume, 120),
      clip_(p.character, 40), clip_(p.impression, 40), Object.keys(details).length ? JSON.stringify(details) : '']);
    return 'ok';
  } catch (err) {
    return 'busy';
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ---------------- menu: check & publish ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('FragranceFlow')
    .addItem('✅ تحقق من البيانات', 'checkData')
    .addItem('🚀 نشر الموقع', 'publishSite')
    .addSeparator()
    .addItem('🔁 تحديث يومي أوتوماتيكي: شعل', 'enableDailyPublish')
    .addItem('⏹ تحديث يومي أوتوماتيكي: طفي', 'disableDailyPublish')
    .addSeparator()
    .addItem('🖼 Cloudinary: عمر روابط الصور', 'fillImagesFromCloudinary')
    .addItem('🖼 Cloudinary: ربط الحساب', 'setCloudinary')
    .addSeparator()
    .addItem('🔑 بدل رابط النشر (Deploy Hook)', 'setDeployHook')
    .addToUi();
}

// the same rules the website applies when it reads the Sheet
function problems_() {
  var out = [], ids = {}, storeIds = {};
  rows_(TAB.perfumes).forEach(function (p, i) {
    var row = i + 2, id = String(p.perfume_id || '').trim();
    if (!id && !p.name) return;
    if (!id || !String(p.name || '').trim() || !String(p.brand || '').trim()) { out.push('Perfumes سطر ' + row + ': perfume_id و name و brand ضروريين'); return; }
    if (ids[id]) out.push('Perfumes سطر ' + row + ': perfume_id مكرر ' + id + ' (كاين ف السطر ' + ids[id] + ')');
    ids[id] = ids[id] || row;
    if (GENDERS.indexOf(String(p.gender).trim().toLowerCase()) === -1) out.push('Perfumes سطر ' + row + ' (' + id + '): gender خاصو يكون men أو women أو unisex');
    var w = String(p.world || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (w && WORLDS.indexOf(w) === -1) out.push('Perfumes سطر ' + row + ' (' + id + '): world غير معروف "' + p.world + '"');
    if (String(p.ref_price || '').trim() && !(Number(p.ref_price) > 0)) out.push('Perfumes سطر ' + row + ' (' + id + '): ref_price خاصو يكون رقم');
  });
  rows_(TAB.stores).forEach(function (s, i) {
    var id = String(s.store_id || '').trim();
    if (!id) return;
    if (storeIds[id]) out.push('Stores سطر ' + (i + 2) + ': store_id مكرر ' + id);
    storeIds[id] = true;
  });
  rows_(TAB.offers).forEach(function (o, i) {
    var row = i + 2;
    if (!o.store_id && !o.perfume_id) return;
    if (!storeIds[String(o.store_id).trim()]) out.push('Offers سطر ' + row + ': store_id ما كاينش ف Stores');
    if (!ids[String(o.perfume_id).trim()]) out.push('Offers سطر ' + row + ': perfume_id ما كاينش ف Perfumes');
    if (o.url && !/^https?:\/\//i.test(String(o.url))) out.push('Offers سطر ' + row + ': url خاصو يبدا بـ https://');
  });
  return out;
}

function checkData() {
  var list = problems_(), ui = SpreadsheetApp.getUi();
  ui.alert(list.length ? 'كاينين ' + list.length + ' مشاكل:\n\n' + list.slice(0, 25).join('\n') + (list.length > 25 ? '\n…' : '')
                       : 'البيانات مزيانة ✅');
  return list.length === 0;
}

function setDeployHook() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('رابط النشر', 'لصق الـ Deploy Hook ديال Vercel (كيبدا بـ https://api.vercel.com/v1/integrations/deploy/…)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  var url = r.getResponseText().trim();
  if (!/^https:\/\/api\.vercel\.com\//.test(url)) { ui.alert('هاد الرابط ماشي ديال Vercel Deploy Hook.'); return null; }
  PropertiesService.getScriptProperties().setProperty('VERCEL_DEPLOY_HOOK', url);
  ui.alert('تسجل ✅');
  return url;
}

function publishSite() {
  var ui = SpreadsheetApp.getUi();
  var list = problems_();
  if (list.length) { ui.alert('ما نشرناش: صلح هاد المشاكل أولا.\n\n' + list.slice(0, 25).join('\n')); return; }
  var hook = PropertiesService.getScriptProperties().getProperty('VERCEL_DEPLOY_HOOK') || setDeployHook();
  if (!hook) return;
  var res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
    ui.alert('🚀 تصيفط. الموقع غادي يتحدث ف دقيقة ولا جوج.');
  } else {
    ui.alert('Vercel جاوب بـ ' + res.getResponseCode() + '. تأكد من رابط النشر (القائمة ← بدل رابط النشر).');
  }
}

/* ---------------- daily refresh (keeps "most looked-for" up to date) ---------------- */

// called every day by the trigger: rebuilds the site so the popular section follows the latest activity
function dailyPublish() {
  var hook = PropertiesService.getScriptProperties().getProperty('VERCEL_DEPLOY_HOOK');
  if (!hook || problems_().length) return; // never publish data that fails the checks
  UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
}
function enableDailyPublish() {
  disableDailyPublish(true);
  ScriptApp.newTrigger('dailyPublish').timeBased().everyDays(1).atHour(5).create();
  SpreadsheetApp.getUi().alert('🔁 تشعل: الموقع غادي يتحدث كل نهار مع 5 د الصباح تقريبا.');
}
function disableDailyPublish(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyPublish') ScriptApp.deleteTrigger(t); });
  if (silent !== true) SpreadsheetApp.getUi().alert('⏹ التحديث اليومي طفا.');
}

/* ---------------- Cloudinary: photo URLs into Perfumes.image_url ---------------- */

var CLD_ROOT = 'fragranceflow/perfumes';

// same rule for the Sheet and for Cloudinary names: "Maison Francis Kurkdjian" → maison-francis-kurkdjian
function slug_(s) {
  return String(s || '').replace(/°/g, '').replace(/&/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function expectedPath_(brand, name) { return CLD_ROOT + '/' + slug_(brand) + '/' + slug_(name); }

function setCloudinary() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var ask = function (title, msg) {
    var r = ui.prompt(title, msg, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };
  var cloud = ask('Cloudinary 1/3', 'Cloud name (كاين ف Cloudinary ← Dashboard)'); if (!cloud) return false;
  var key = ask('Cloudinary 2/3', 'API Key (Settings ← API Keys)'); if (!key) return false;
  var secret = ask('Cloudinary 3/3', 'API Secret (Settings ← API Keys). كيتسجل غير ف هاد السكريبت، ما كيبانش ف الـ Sheet ولا ف الموقع.'); if (!secret) return false;
  props.setProperties({ CLD_CLOUD: cloud, CLD_KEY: key, CLD_SECRET: secret });
  ui.alert('تسجل ✅ دابا: FragranceFlow ← 🖼 Cloudinary: عمر روابط الصور');
  return true;
}

// every image under fragranceflow/perfumes/ (works with fixed and dynamic folder accounts)
function cldResources_(cloud, key, secret) {
  var auth = 'Basic ' + Utilities.base64Encode(key + ':' + secret), found = {};
  ['folder:"' + CLD_ROOT + '/*"', 'asset_folder:"' + CLD_ROOT + '/*"'].forEach(function (expr) {
    var cursor = null, guard = 0;
    do {
      var body = { expression: expr + ' AND resource_type:image', max_results: 500 };
      if (cursor) body.next_cursor = cursor;
      var res = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(cloud) + '/resources/search', {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
        headers: { Authorization: auth }, muteHttpExceptions: true });
      var code = res.getResponseCode();
      if (code === 401 || code === 403) throw new Error('auth');
      if (code !== 200) break;
      var j = JSON.parse(res.getContentText());
      (j.resources || []).forEach(function (r) { found[r.public_id] = r; });
      cursor = j.next_cursor;
    } while (cursor && ++guard < 20);
  });
  return Object.keys(found).map(function (k) { return found[k]; });
}

// "<brand>/<perfume>" for a Cloudinary image, from its folder and its name
function cldKey_(r) {
  var parts = String(r.public_id || '').split('/');
  var base = r.display_name || parts[parts.length - 1];
  var folder = r.asset_folder || r.folder || parts.slice(0, -1).join('/');
  var brand = String(folder).split('/').pop();
  base = String(base).replace(/_[a-z0-9]{6}$/i, ''); // random suffix Cloudinary adds when "unique filename" is on
  return slug_(brand) + '/' + slug_(base);
}

function fillImagesFromCloudinary() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLD_SECRET') && !setCloudinary()) return;
  var list;
  try { list = cldResources_(props.getProperty('CLD_CLOUD'), props.getProperty('CLD_KEY'), props.getProperty('CLD_SECRET')); }
  catch (e) { ui.alert('Cloudinary رفض الدخول: تأكد من Cloud name و API Key و API Secret (القائمة ← 🖼 Cloudinary: ربط الحساب).'); return; }
  var byKey = {};
  list.forEach(function (r) { if (r.secure_url) byKey[cldKey_(r)] = r.secure_url; });

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.perfumes);
  var values = sh.getDataRange().getValues(), head = values[0].map(function (h) { return String(h).trim(); });
  var cUrl = head.indexOf('image_url'), cBrand = head.indexOf('brand'), cName = head.indexOf('name');
  if (cUrl < 0 || cBrand < 0 || cName < 0) { ui.alert('تبويب Perfumes خاصو الأعمدة name و brand و image_url.'); return; }
  var filled = 0, kept = 0, missing = [], col = [];
  for (var i = 1; i < values.length; i++) {
    var name = values[i][cName], brand = values[i][cBrand], cur = String(values[i][cUrl] || '').trim();
    col.push([values[i][cUrl]]);
    if (!String(name).trim()) continue;
    var url = byKey[slug_(brand) + '/' + slug_(name)];
    // only URLs Cloudinary returned; a link someone typed by hand (not Cloudinary) is never replaced
    if (url && (!cur || /res\.cloudinary\.com/.test(cur))) { if (cur !== url) { col[i - 1] = [url]; filled++; } else kept++; }
    else if (url) kept++;
    else if (!cur) missing.push(expectedPath_(brand, name));
  }
  if (values.length > 1) sh.getRange(2, cUrl + 1, values.length - 1, 1).setValues(col);
  ui.alert('🖼 Cloudinary: ' + list.length + ' صورة لقينا.\n\n' +
    '✅ تعمرو: ' + filled + '\n' + '↔️ كانو ديجا مزيانين: ' + kept + '\n' + '⏳ بلا صورة (كيبقاو بالصورة التوضيحية): ' + missing.length +
    (missing.length ? '\n\nالصور لي ناقصين، حطهم ف Cloudinary بهاد السمية:\n' + missing.slice(0, 15).join('\n') + (missing.length > 15 ? '\n…' : '') : '') +
    '\n\nمن بعد: 🚀 نشر الموقع');
}

/* ---------------- helpers ---------------- */

// cut long values and neutralise spreadsheet formulas (a value starting with = + - @)
function clip_(v, n) {
  var s = String(v == null ? '' : v).slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function text_(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
