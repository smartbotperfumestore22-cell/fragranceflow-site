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

var TAB = { perfumes: 'Perfumes', stores: 'Stores', offers: 'Offers', events: 'Events', stats: 'Daily_Stats' };
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
  if (p.action === 'stats') return json_(storeStats_(p.t, p.days));
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
    .addItem('📊 الإحصائيات: حساب يومي أوتوماتيكي: شعل', 'enableDailyStats')
    .addItem('📊 الإحصائيات: عاود الحساب من نهار…', 'rebuildStatsPrompt')
    .addItem('🔑 رابط الإحصائيات ديال متجر', 'dashboardLinkPrompt')
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

/* ---------------- statistics for the stores (Daily_Stats) ----------------
 * Events stays the source of truth. Daily_Stats holds one line per day × store × metric × dimension, so the
 * dashboard never reads the raw Events. Any range of days can be rebuilt from Events (rebuildStats).
 *   metrics (dimension "all"): experiences (visits that opened the quiz), completed (visits that finished it),
 *     quizzes (finished quizzes, a visit can do several), whatsapp (WhatsApp clicks), whatsapp_visits,
 *     shares (profile shared on a network or copied), near (no exact match: closest fragrances shown)
 *   metrics with a dimension: source (visits by source), family (Q4 answer), impression (Q5 answer),
 *     perfume (times shown in the results, by perfume_id), whatsapp_perfume (WhatsApp clicks by perfume_id)
 *   store "_site" = visits without a store link (the FragranceFlow quiz itself).
 */
var STATS_START = '2026-10-26';          // days before this are never counted (tests before the launch)
var STATS_TZ = 'Africa/Casablanca';
var STATS_HEADER = ['date', 'store_id', 'metric', 'dimension', 'value'];
var SHARE_EVENTS = ['personality_share_whatsapp', 'personality_share_facebook', 'personality_share_instagram', 'personality_share_copy'];

function day_(d) { return Utilities.formatDate(d, STATS_TZ, 'yyyy-MM-dd'); }

// perfume id in one form (FF-0037), from the Perfume ID column, the old details, or the name
function pid_(raw, name, byName) {
  var v = String(raw || '').trim();
  var m = v.match(/^ff-?0*(\d+)$/i);
  if (m) return 'FF-' + ('0000' + m[1]).slice(-4);
  if (v) return v.toUpperCase();
  return byName[String(name || '').trim().toLowerCase()] || '';
}

// the Events rows of the given days (yyyy-MM-dd strings), as plain objects
function eventsFor_(days) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.events);
  if (!sh || sh.getLastRow() < 2) return [];
  var want = {}; days.forEach(function (d) { want[d] = 1; });
  var byName = {};
  rows_(TAB.perfumes).forEach(function (p) { if (p.name && p.perfume_id) byName[String(p.name).trim().toLowerCase()] = String(p.perfume_id).trim(); });
  var out = [];
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!(r[0] instanceof Date)) return;
    var d = day_(r[0]);
    if (!want[d]) return;
    var det = {};
    try { det = r[7] ? JSON.parse(r[7]) : {}; } catch (e) {}
    out.push({ day: d, event: String(r[1]), visit: String(r[2] || det.visit || ''), source: String(r[3] || '').toLowerCase(),
      perfume: pid_(r[9] || det.pid, r[4], byName), character: String(r[5] || ''), impression: String(r[6] || ''),
      store: String(r[8] || det.shop || '').toLowerCase() || '_site' });
  });
  return out;
}

// counts of one day, as Daily_Stats lines
function statsOfDay_(day, events) {
  var acc = {};                                   // store|metric|dimension → value
  var add = function (store, metric, dim, n) { var k = store + '|' + metric + '|' + (dim || 'all'); acc[k] = (acc[k] || 0) + (n || 1); };
  var visits = {};                                // store|visit → { source, opened, completed, whatsapp }
  events.forEach(function (e) {
    if (e.day !== day) return;
    var vk = e.store + '|' + (e.visit || ('~' + Math.random()));
    var v = visits[vk] || (visits[vk] = { store: e.store, source: '', opened: false, completed: false, whatsapp: false });
    if (!v.source && e.source) v.source = e.source;
    if (e.event === 'widget_open') v.opened = true;
    if (e.event === 'quiz_complete') {
      v.completed = true; add(e.store, 'quizzes');
      if (e.character) add(e.store, 'family', e.character);
      if (e.impression) add(e.store, 'impression', e.impression);
    }
    if (e.event === 'result_shown' && e.perfume) add(e.store, 'perfume', e.perfume);
    if (e.event === 'whatsapp_click' || e.event === 'near_whatsapp_click') {
      v.whatsapp = true; add(e.store, 'whatsapp');
      if (e.perfume) add(e.store, 'whatsapp_perfume', e.perfume);
    }
    if (SHARE_EVENTS.indexOf(e.event) !== -1) add(e.store, 'shares');
    if (e.event === 'near_results' || e.event === 'lost_sale') add(e.store, 'near');
  });
  Object.keys(visits).forEach(function (k) {
    var v = visits[k];
    if (!v.opened && !v.completed) return;        // a visit that only looked at a fragrance page is not an experience
    add(v.store, 'experiences');
    add(v.store, 'source', v.source || 'direct');
    if (v.completed) add(v.store, 'completed');
    if (v.whatsapp) add(v.store, 'whatsapp_visits');
  });
  return Object.keys(acc).sort().map(function (k) { var p = k.split('|'); return [day, p[0], p[1], p[2], acc[k]]; });
}

// rebuild Daily_Stats for every day from `from` to `to` (yyyy-MM-dd, both included); other days are kept as they are
function rebuildStats(from, to) {
  if (from < STATS_START) from = STATS_START;
  var days = [], d = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z');
  while (d <= end) { days.push(Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')); d = new Date(d.getTime() + 864e5); }
  if (!days.length) return 0;
  var events = eventsFor_(days), fresh = [];
  days.forEach(function (day) { fresh = fresh.concat(statsOfDay_(day, events)); });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB.stats) || ss.insertSheet(TAB.stats);
    var old = sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1) : [];
    var redo = {}; days.forEach(function (x) { redo[x] = 1; });
    var keep = old.filter(function (r) { var x = r[0] instanceof Date ? day_(r[0]) : String(r[0]); return !redo[x]; })
      .map(function (r) { return [r[0] instanceof Date ? day_(r[0]) : String(r[0]), r[1], r[2], r[3], r[4]]; });
    var all = keep.concat(fresh).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    sh.clearContents();
    sh.getRange(1, 1, 1, STATS_HEADER.length).setValues([STATS_HEADER]);
    if (all.length) {
      sh.getRange(2, 1, all.length, 1).setNumberFormat('@');          // dates stay text (yyyy-MM-dd), not converted
      sh.getRange(2, 1, all.length, STATS_HEADER.length).setValues(all);
    }
    sh.setFrozenRows(1);
  } finally { lock.releaseLock(); }
  return fresh.length;
}

// every night: yesterday (and the day before, in case an event arrived late)
function nightlyStats() {
  var now = new Date();
  rebuildStats(day_(new Date(now.getTime() - 2 * 864e5)), day_(new Date(now.getTime() - 864e5)));
}
function enableDailyStats() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'nightlyStats') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyStats').timeBased().everyDays(1).atHour(2).create();
  var n = rebuildStats(STATS_START, day_(new Date()));
  SpreadsheetApp.getUi().alert('📊 تشعل: الإحصائيات غادي تتحسب كل ليلة مع 2 د الصباح.\nدابا تحسبو ' + n + ' سطر من ' + STATS_START + ' حتى اليوم.');
}
function rebuildStatsPrompt() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('عاود الحساب', 'من أي نهار؟ (yyyy-MM-dd، مثلا ' + STATS_START + ')', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var from = r.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) { ui.alert('كتب التاريخ بهاد الشكل: 2026-10-26'); return; }
  var n = rebuildStats(from, day_(new Date()));
  ui.alert('✅ تعاود الحساب: ' + n + ' سطر.');
}

/* ---------------- store dashboard: secret link ----------------
 * Each store gets a long random token (Stores → column dash_token). The dashboard sends only this token;
 * the script finds the store from it, so a store can never ask for another store's numbers by changing an id.
 * Only aggregated numbers are returned, never the raw Events.
 */
var SITE_URL = 'https://fragranceflow-site-three.vercel.app';

function storeByToken_(t) {
  t = String(t || '').trim();
  if (!/^[A-Za-z0-9]{32,80}$/.test(t)) return null;
  var cache = CacheService.getScriptCache(), hit = cache.get('ff_tok_' + t);
  if (hit) return JSON.parse(hit);
  var found = null;
  rows_(TAB.stores).forEach(function (s) {
    if (!found && String(s.dash_token || '').trim() === t && String(s.active).toUpperCase() !== 'FALSE')
      found = { id: String(s.store_id).trim().toLowerCase(), name: String(s.name || s.store_id),
        logo: /^https:\/\//.test(String(s.logo_url || '')) ? String(s.logo_url) : '', color: /^#[0-9a-f]{6}$/i.test(String(s.color || '')) ? String(s.color) : '' };
  });
  if (found) cache.put('ff_tok_' + t, JSON.stringify(found), 600);
  return found;
}

function storeStats_(token, daysParam) {
  var store = storeByToken_(token);
  if (!store) return { error: 'invalid' };
  var n = Math.max(7, Math.min(90, Number(daysParam) || 30));
  var now = new Date(), today = day_(now), from = day_(new Date(now.getTime() - (n - 1) * 864e5));
  if (from < STATS_START) from = STATS_START;
  var lines = [], prev = {};
  // the period just before, same length, for the "compared with before" figures (never before STATS_START)
  var len = Math.round((new Date(today + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 864e5) + 1;
  var prevFrom = day_(new Date(new Date(from + 'T12:00:00Z').getTime() - len * 864e5));
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.stats);
  if (sh && sh.getLastRow() > 1) sh.getDataRange().getValues().slice(1).forEach(function (r) {
    var d = r[0] instanceof Date ? day_(r[0]) : String(r[0]);
    if (String(r[1]) !== store.id) return;
    if (d >= from && d < today) lines.push([d, r[2], String(r[3]), Number(r[4]) || 0]);
    else if (d >= prevFrom && d < from && d >= STATS_START && String(r[3]) === 'all') prev[r[2]] = (prev[r[2]] || 0) + (Number(r[4]) || 0);
  });
  // today is not in Daily_Stats yet (built at night): count it from today's events
  statsOfDay_(today, eventsFor_([today])).forEach(function (r) { if (r[1] === store.id) lines.push([r[0], r[2], r[3], r[4]]); });

  var days = [], d = new Date(from + 'T12:00:00Z'), end = new Date(today + 'T12:00:00Z');
  while (d <= end) { days.push(Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')); d = new Date(d.getTime() + 864e5); }
  var idx = {}; days.forEach(function (x, i) { idx[x] = i; });
  var series = {}, totals = {}, dims = {};
  ['experiences', 'completed', 'whatsapp', 'shares'].forEach(function (m) { series[m] = days.map(function () { return 0; }); });
  lines.forEach(function (l) {
    var day = l[0], metric = l[1], dim = l[2], v = l[3];
    if (dim === 'all') {
      totals[metric] = (totals[metric] || 0) + v;
      if (series[metric] && idx[day] != null) series[metric][idx[day]] += v;
    } else {
      dims[metric] = dims[metric] || {};
      dims[metric][dim] = (dims[metric][dim] || 0) + v;
    }
  });
  var names = {};
  rows_(TAB.perfumes).forEach(function (p) { if (p.perfume_id) names[String(p.perfume_id).trim().toUpperCase()] = { name: String(p.name || ''), brand: String(p.brand || '') }; });
  var shown = dims.perfume || {}, wa = dims.whatsapp_perfume || {};
  var perfumes = Object.keys(shown).concat(Object.keys(wa)).filter(function (x, i, a) { return a.indexOf(x) === i; })
    .map(function (id) { var m = names[id] || {}; return { id: id, name: m.name || id, brand: m.brand || '', shown: shown[id] || 0, whatsapp: wa[id] || 0 }; })
    .sort(function (a, b) { return b.shown - a.shown || b.whatsapp - a.whatsapp; }).slice(0, 10);
  return { store: store, from: from, to: today, days: days, series: series, totals: totals,
    prev: prevFrom >= STATS_START ? prev : null,
    source: dims.source || {}, family: dims.family || {}, impression: dims.impression || {}, perfumes: perfumes };
}

// a small window with the link in a box that can be selected and copied (an alert's text cannot be copied)
function showLink_(id, url) {
  var safe = String(url).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  var html = HtmlService.createHtmlOutput(
    '<div dir="rtl" style="font-family:sans-serif;font-size:14px">' +
    '<p>الرابط ديال <b>' + id + '</b>. صيفطو للتاجر، وما تنشروش:</p>' +
    '<input id="l" readonly value="' + safe + '" style="width:100%;padding:8px;font-size:12px;direction:ltr" onclick="this.select()">' +
    '<p><button onclick="var i=document.getElementById(\'l\');i.select();document.execCommand(\'copy\');this.textContent=\'تنسخ ✓\'" ' +
    'style="padding:8px 16px;background:#5B35C8;color:#fff;border:0;border-radius:8px;cursor:pointer">نسخ الرابط</button></p></div>'
  ).setWidth(520).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, 'رابط الإحصائيات');
}

// menu: make (or replace) the secret dashboard link of a store
function dashboardLinkPrompt() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('رابط الإحصائيات', 'store_id ديال المتجر (مثلا ada-parfum):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var id = r.getResponseText().trim().toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.stores);
  var values = sh.getDataRange().getValues(), head = values[0].map(function (h) { return String(h).trim(); });
  var col = head.indexOf('dash_token');
  if (col === -1) { col = head.length; sh.getRange(1, col + 1).setValue('dash_token'); }
  var row = -1, idCol = head.indexOf('store_id');
  for (var i = 1; i < values.length; i++) if (String(values[i][idCol]).trim().toLowerCase() === id) { row = i; break; }
  if (row === -1) { ui.alert('ما لقيتش متجر بهاد store_id ف Stores.'); return; }
  var old = col < values[row].length ? String(values[row][col] || '').trim() : '';
  if (old) {
    var again = ui.alert('هاد المتجر عندو رابط من قبل', 'نصاوب رابط جديد؟ الرابط القديم غادي يوقف.', ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) { showLink_(id, SITE_URL + '/dashboard/?t=' + old); return; }
    CacheService.getScriptCache().remove('ff_tok_' + old);
  }
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 64 random hex characters
  sh.getRange(row + 1, col + 1).setValue(token);
  showLink_(id, SITE_URL + '/dashboard/?t=' + token);
}

/* ---------------- helpers ---------------- */

// cut long values and neutralise spreadsheet formulas (a value starting with = + - @)
function clip_(v, n) {
  var s = String(v == null ? '' : v).slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function text_(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
