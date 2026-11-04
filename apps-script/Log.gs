/**
 * Logging to the Log tab, and throttled alert emails for unexpected errors.
 * Keep customer personal data out of log messages.
 */

var ALERT_THROTTLE_S = 900; // at most one alert email per 15 minutes

function log_(level, message) {
  try {
    var sh = ss_().getSheetByName(SHEETS.LOG);
    if (!sh) return;
    sh.appendRow([new Date(), level, cellText_(String(message).slice(0, 2000))]);
  } catch (err) {
    console.error('log_ failed: ' + (err && err.message) + ' | ' + message);
  }
}

function alert_(subject, body) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('alert_throttle')) return;
    cache.put('alert_throttle', '1', ALERT_THROTTLE_S);

    var to = '';
    try { to = String(readSettingsRaw_().alert_email || '').trim(); } catch (e) { to = ''; }
    if (!to) to = Session.getEffectiveUser().getEmail();
    if (!to) return;

    GmailApp.sendEmail(to, '[Fruitcake orders] ' + subject,
      body + '\n\nSee the Log tab in the orders sheet for details. ' +
      'Further alerts are paused for ' + (ALERT_THROTTLE_S / 60) + ' minutes.');
  } catch (err) {
    console.error('alert_ failed: ' + (err && err.message));
  }
}

/** Logs, alerts, and returns a friendly error. Never exposes stack traces. */
function handleUnexpected_(err, where) {
  var message = (err && err.message) || String(err);
  var stack = (err && err.stack) || '';
  log_('ERROR', where + ': ' + message + (stack ? ' | ' + stack : ''));
  alert_(err && err.isSettingsError ? 'Settings problem' : 'Unexpected error in ' + where,
    where + ': ' + message + '\n\n' + stack);
  return fail_('Sorry, our order system is having a problem right now. Your order has not been placed.',
    { code: 'server_error' });
}
