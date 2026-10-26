/**
 * FragranceFlow — Google Sheet ↔ website
 *
 * One script, bound to the FragranceFlow Sheet (tabs: Perfumes, Stores, Offers, Events).
 *   Offers → column "size_type": full (قنينة كاملة), decant (ديكونط) or both (بجوج) — shown in «فين تلقاه؟».
 *   Stores → optional columns "logo_url" (https image) and "color" (#rrggbb): the store link shows them.
 *   • ?action=catalog   → the website reads Perfumes / Stores / Offers when it is built
 *   • ?action=analytics → the website records an event in the Events tab
 *     (never send a parameter named "sid" or "c": Apps Script reserves them and answers 400)
 *   • Menu "FragranceFlow" → "Check data" and "Publish the site" (rebuilds the site on Vercel)
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
  'perfume_view', 'search_pick',
  'near_results', 'near_whatsapp_click'
];
// visit sources a link can carry (?source= or ?utm_source=); anything else is recorded as "other"
var SOURCES = ['instagram', 'whatsapp', 'facebook', 'tiktok', 'website', 'qr', 'direct'];
// at most this many events per visit and per hour (stops a script from filling the Events tab)
var MAX_EVENTS_PER_VISIT = 80;
// "most looked-for" score per fragrance, over the last POP_DAYS days of the Events tab
var POP_DAYS = 30;
var POP_WEIGHTS = { perfume_view: 1, search_pick: 2, favorite_pick: 3, buy_click: 4, whatsapp_click: 4 };
var EVENT_HEADER = ['Time', 'Event', 'Session', 'Source', 'Perfume / answer', 'Character', 'Impression', 'Details', 'Store', 'Perfume ID'];
var EVENT_SKIP = ['action', 'store', 'key', 'event', 'visit', 'utm', 'source', 'perfume', 'character', 'impression', 'shop', 'pid'];

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

// ids of the active stores (Stores tab), cached for 10 minutes so each event does not read the tab
function activeStores_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('ff_active_stores');
  if (hit) return JSON.parse(hit);
  var ids = rows_(TAB.stores).filter(function (s) { return s.store_id && String(s.active).toUpperCase() !== 'FALSE'; })
    .map(function (s) { return String(s.store_id).trim().toLowerCase(); });
  cache.put('ff_active_stores', JSON.stringify(ids), 600);
  return ids;
}

// one source name: instagram, whatsapp, … or "other"; empty when the link carried none
function source_(v) {
  v = String(v || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'ig' || v === 'insta') v = 'instagram';
  if (v === 'wa') v = 'whatsapp';
  return SOURCES.indexOf(v) !== -1 ? v : 'other';
}

function recordEvent_(p) {
  if (EVENTS.indexOf(p.event) === -1) return 'ignored';
  // an event that names a store must name an active one (a typo or a forged id is not recorded)
  var shop = String(p.shop || '').trim().toLowerCase();
  if (shop && activeStores_().indexOf(shop) === -1) return 'ignored';
  // a visit id is required, and a visit cannot send more than MAX_EVENTS_PER_VISIT events an hour
  var visit = String(p.visit || '').trim();
  if (!/^[\w-]{4,20}$/.test(visit)) return 'ignored';
  var cache = CacheService.getScriptCache(), ck = 'ff_v_' + visit, n = Number(cache.get(ck) || 0) + 1;
  if (n > MAX_EVENTS_PER_VISIT) return 'ignored';
  cache.put(ck, String(n), 3600);

  var details = {};
  Object.keys(p).forEach(function (k) { if (EVENT_SKIP.indexOf(k) === -1) details[clip_(k, 40)] = clip_(p[k], 200); });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB.events);
    if (!sh) { sh = ss.insertSheet(TAB.events); sh.appendRow(EVENT_HEADER); sh.setFrozenRows(1); }
    else if (sh.getLastColumn() < EVENT_HEADER.length) sh.getRange(1, 1, 1, EVENT_HEADER.length).setValues([EVENT_HEADER]); // new columns
    sh.appendRow([new Date(), p.event, clip_(visit, 20), source_(p.source || p.utm), clip_(p.perfume, 120),
      clip_(p.character, 40), clip_(p.impression, 40), Object.keys(details).length ? JSON.stringify(details) : '',
      shop, clip_(p.pid, 20)]);
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
    var fmt = String(o.size_type || o.format || '').trim().toLowerCase();
    if (fmt && !/full|decant|décant|both|كامل|قنينة|قارورة|ديك|بجوج|جوج/.test(fmt)) out.push('Offers سطر ' + row + ': size_type خاصو يكون full ولا decant ولا both');
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

/* ---------------- helpers ---------------- */

// cut long values and neutralise spreadsheet formulas (a value starting with = + - @)
function clip_(v, n) {
  var s = String(v == null ? '' : v).slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function text_(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
