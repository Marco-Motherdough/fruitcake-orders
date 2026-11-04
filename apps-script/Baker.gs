/**
 * Baker app: a staff-only page listing orders, where the baker moves each
 * order through its stages (Baked, Decorated, Packed, ...).
 *
 * Served by doGet() when there is no ?action. It works only on a deployment
 * with access "Anyone within Motherdough", so Google signs the user in, and
 * only addresses listed in Settings `staff_emails` are let in.
 *
 * Functions without a trailing underscore can be called from the page with
 * google.script.run, so every one of them checks the user first.
 */

var DEFAULT_STAGES = ['New', 'Baked', 'Decorated', 'Packed', 'Ready for collection', 'Collected'];
var CANCELLED = 'Cancelled';

/** Returns the signed-in staff email, or '' if the user is not on the staff list. */
function staffEmail_() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  if (!email) return '';
  var raw = readSettingsRaw_();
  var staff = String(raw.staff_emails || '').toLowerCase().split(/[,;\s]+/).filter(String);
  return staff.indexOf(email) !== -1 ? email : '';
}

function bakerStages_() {
  var raw = readSettingsRaw_();
  var list = String(raw.baker_stages || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  return list.length ? list : DEFAULT_STAGES;
}

/** Old rows say "confirmed"; show them as the first stage. */
function displayStatus_(status, stages) {
  var s = String(status || '').trim();
  if (!s || s.toLowerCase() === 'confirmed') return stages[0];
  for (var i = 0; i < stages.length; i++) if (stages[i].toLowerCase() === s.toLowerCase()) return stages[i];
  if (s.toLowerCase() === CANCELLED.toLowerCase()) return CANCELLED;
  return s;
}

function serveBakerApp_() {
  var email = staffEmail_();
  var t = HtmlService.createTemplateFromFile('baker');
  t.allowed = !!email;
  t.email = email || String(Session.getActiveUser().getEmail() || '');
  return t.evaluate()
    .setTitle('Fruitcake orders · Baker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from the baker page. */
function bakerGetOrders() {
  var who = staffEmail_();
  if (!who) return { ok: false, error: 'You are not on the staff list.' };

  var stages = bakerStages_();
  var t = readOrders_();
  var h = t.header;
  function col(name) { return h.indexOf(name); }
  var c = {
    num: col('order_number'), created: col('created_at'), status: col('status'), date: col('pickup_date'),
    store: col('store'), name: col('name'), cell: col('cell'), product: col('product'),
    qty: col('quantity'), notes: col('notes'), updated: col('status_updated')
  };
  var today = todayIso_();
  var orders = [];
  for (var r = 1; r < t.data.length; r++) {
    var row = t.data[r];
    if (!row[c.num]) continue;
    var pickup = toIso_(row[c.date]);
    orders.push({
      order_number: String(row[c.num]),
      created_at: row[c.created] instanceof Date ? row[c.created].getTime() : null,
      status: displayStatus_(row[c.status], stages),
      pickup_date: pickup,
      store: String(row[c.store]),
      name: String(row[c.name]),
      cell: String(row[c.cell]),
      product: String(row[c.product]),
      quantity: Number(row[c.qty]) || 0,
      notes: String(row[c.notes] || ''),
      status_updated: c.updated === -1 ? '' : String(row[c.updated] || ''),
      past: pickup && pickup < today
    });
  }
  return { ok: true, today: today, stages: stages, cancelled: CANCELLED, orders: orders, user: who };
}

/** Called from the baker page. Sets one order's stage. */
function bakerSetStatus(orderNumber, status) {
  var who = staffEmail_();
  if (!who) return { ok: false, error: 'You are not on the staff list.' };
  var stages = bakerStages_();
  if (stages.indexOf(status) === -1 && status !== CANCELLED) return { ok: false, error: 'Unknown stage.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'Busy, please try again.' };
  try {
    var t = readOrders_();
    var iNum = t.header.indexOf('order_number'), iStatus = t.header.indexOf('status');
    var iUpdated = t.header.indexOf('status_updated');
    for (var r = 1; r < t.data.length; r++) {
      if (String(t.data[r][iNum]) !== String(orderNumber)) continue;
      t.sh.getRange(r + 1, iStatus + 1).setValue(status);
      var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' ' + who;
      if (iUpdated !== -1) t.sh.getRange(r + 1, iUpdated + 1).setValue(stamp);
      SpreadsheetApp.flush();
      // Cancelling (or un-cancelling) changes free capacity.
      clearConfigCache_();
      return { ok: true, status: status, status_updated: stamp };
    }
    return { ok: false, error: 'Order not found.' };
  } finally {
    lock.releaseLock();
  }
}
