/**
 * FragranceFlow — site analytics (events only).
 *
 * Records what visitors do on the FragranceFlow site in one Google Sheet tab ("Events").
 * It never reads or changes the perfume catalogue or the Master Database; the site keeps
 * its perfumes from its own catalogue. No personal data is received or stored: only the
 * event name, an anonymous per-tab id and the quiz/share details the site already sends.
 *
 * Setup (once):
 *   1. Create a new Google Sheet (e.g. "FragranceFlow — Site Analytics").
 *   2. Extensions → Apps Script, delete the sample code, paste this file, Save.
 *   3. Deploy → New deployment → type "Web app":
 *        Execute as: Me      Who has access: Anyone
 *      Copy the Web app URL (ends with /exec).
 *   4. Vercel → the project → Settings → Environment Variables:
 *        Name VITE_ANALYTICS_URL, value = that URL, environments Production + Preview.
 *   5. Redeploy the site (Deployments → ⋯ → Redeploy). Events appear in the "Events" tab.
 * After editing this script later: Deploy → Manage deployments → Edit → Version "New version",
 * so the same /exec URL keeps working.
 */

// events the site sends; anything else is ignored so the sheet stays clean
var EVENTS = [
  'widget_open', 'quiz_complete', 'result_shown', 'persona_feedback', 'favorite_pick',
  'buy_click', 'whatsapp_click', 'lost_sale',
  'personality_share_click', 'personality_share_whatsapp', 'personality_share_facebook',
  'personality_share_instagram', 'personality_share_copy'
];
var HEADER = ['Time', 'Event', 'Session', 'Source', 'Perfume / answer', 'Character', 'Impression', 'Details'];
var SKIP = ['action', 'store', 'key', 'event', 'sid', 'utm', 'perfume', 'character', 'impression'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'analytics' || EVENTS.indexOf(p.event) === -1) return reply_('ignored');

  var details = {};
  Object.keys(p).forEach(function (k) {
    if (SKIP.indexOf(k) === -1) details[clip_(k, 40)] = clip_(p[k], 200);
  });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var sh = sheet_();
    sh.appendRow([
      new Date(), p.event, clip_(p.sid, 20), clip_(p.utm, 40),
      clip_(p.perfume, 120), clip_(p.character, 40), clip_(p.impression, 40),
      Object.keys(details).length ? JSON.stringify(details) : ''
    ]);
  } catch (err) {
    return reply_('busy');
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  return reply_('ok');
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Events');
  if (!sh) {
    sh = ss.insertSheet('Events');
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  }
  return sh;
}

// cut long values and neutralise spreadsheet formulas (a value starting with = + - @)
function clip_(v, n) {
  var s = String(v == null ? '' : v).slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
