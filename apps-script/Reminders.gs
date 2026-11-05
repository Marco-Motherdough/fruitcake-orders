/**
 * Day-before reminder emails.
 *
 * Run sendReminders() once a day from a time-driven trigger (Triggers →
 * Add Trigger → sendReminders → Time-driven → Day timer → 7am to 8am).
 * It emails every customer collecting tomorrow, once, skipping cancelled
 * and already-collected orders. Progress is kept in the reminder_sent column.
 */
function sendReminders() {
  var s = readSettings_();
  if (!s.emails_enabled || !s.reminders_enabled) return;

  var tomorrow = addDaysIso_(todayIso_(), 1);
  var stages = bakerStages_();
  var done = [CANCELLED.toLowerCase(), stages[stages.length - 1].toLowerCase(), 'cancelled', 'collected'];

  // Claim tomorrow's rows under the lock so two runs never email twice.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return;
  var claimed = [];
  try {
    var t = readOrders_();
    var h = t.header;
    var iDate = h.indexOf('pickup_date'), iStatus = h.indexOf('status'), iRem = h.indexOf('reminder_sent');
    if (iRem === -1) throw settingsError_('Orders tab is missing the reminder_sent column');
    for (var r = 1; r < t.data.length; r++) {
      var row = t.data[r];
      if (toIso_(row[iDate]) !== tomorrow) continue;
      if (String(row[iRem] || '') !== '') continue;
      if (done.indexOf(String(row[iStatus] || '').trim().toLowerCase()) !== -1) continue;
      t.sh.getRange(r + 1, iRem + 1).setValue('sending');
      claimed.push({ rowIndex: r + 1, row: row, header: h });
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  claimed.forEach(function (c) {
    var o = orderFromRow_(c.row, c.header, s);
    var ctx = { order: o, settings: s, summary: orderSummary_(o), reminder: true };
    markEmail_(c.rowIndex, c.header, 'reminder_sent', trySend_(sendCustomerEmail_, ctx, o.order_number, 'reminder'));
  });
  if (claimed.length) log_('INFO', 'Sent ' + claimed.length + ' reminder(s) for ' + tomorrow);
}
