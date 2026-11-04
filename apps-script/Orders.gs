/**
 * Order placement: validate, lock, re-check capacity, append, email.
 */

var RATE_LIMIT_MAX = 3;          // orders per email ...
var RATE_LIMIT_WINDOW_S = 600;   // ... per 10 minutes
var LOCK_WAIT_MS = 10000;

function placeOrder_(body) {
  // 1. Honeypot.
  if (body.website) {
    log_('WARN', 'Rejected order: honeypot field filled');
    return fail_('Sorry, we could not place this order. Please call the shop.', { code: 'rejected' });
  }

  var s = readSettings_();
  var today = todayIso_();
  if (today > s.last_order_date) {
    log_('INFO', 'Rejected order: ordering closed (cut-off ' + s.last_order_date + ')');
    return fail_(closedMessage_(s), { code: 'closed' });
  }

  // 2. Validate every field and work out the total from Settings prices.
  var v = validateOrder_(body, s);
  if (v.error) {
    log_('INFO', 'Rejected order: ' + v.log);
    return fail_(v.error, { code: 'invalid', field: v.field });
  }
  var o = v.order;

  // Rate limit per email address.
  if (!rateLimitOk_(o.email)) {
    log_('WARN', 'Rejected order: rate limit hit');
    return fail_('We have received several orders from this email address in the last few minutes. ' +
      'Please wait a little before trying again, or call the shop.', { code: 'rate_limited' });
  }

  // 3. Lock, re-check capacity, number and append.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    log_('WARN', 'Order not placed: could not get lock in time');
    return fail_('We are very busy right now. Your order has not been placed yet, please try again.', { code: 'busy' });
  }

  var rowIndex, header;
  try {
    var availability = computeAvailability_(s, bookedByDate_(), capacityOverrides_(), today);
    var day = null;
    for (var i = 0; i < availability.length; i++) {
      if (availability[i].date === o.pickup_date) { day = availability[i]; break; }
    }
    if (!day || day.status === 'closed') {
      log_('INFO', 'Rejected order: pickup date ' + o.pickup_date + ' not available');
      return fail_('Sorry, ' + shortDate_(o.pickup_date) + ' is not available for pickup. Please choose another date.',
        { code: 'date_unavailable', availability: availability });
    }
    if (day.remaining < o.quantity) {
      log_('INFO', 'Rejected order: ' + o.pickup_date + ' has ' + day.remaining + ' left, wanted ' + o.quantity);
      var msg = day.remaining > 0
        ? 'Sorry, there ' + (day.remaining === 1 ? 'is only 1 cake' : 'are only ' + day.remaining + ' cakes') +
          ' left for ' + shortDate_(o.pickup_date) + '. Please choose another date or a smaller quantity.'
        : 'Sorry, ' + shortDate_(o.pickup_date) + ' filled up while you were choosing. Please pick another date.';
      return fail_(msg, { code: 'date_full', availability: availability });
    }

    o.order_number = nextOrderNumber_();
    var sh = sheet_(SHEETS.ORDERS);
    header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var record = {
      order_number: o.order_number,
      created_at: new Date(),
      status: s.first_stage,
      pickup_date: isoToSheetDate_(o.pickup_date),
      pickup_slot: o.slot.label + ' ' + o.slot.start + '–' + o.slot.end,
      store: o.store.name,
      name: cellText_(o.name),
      cell: o.cell, // the row's cell format is text, so the leading 0 stays
      email: cellText_(o.email),
      product: s.product_name,
      quantity: o.quantity,
      notes: cellText_(o.notes),
      total: o.total === null ? '' : o.total,
      consent: 'yes',
      source: cellText_(o.source),
      email_customer_sent: s.emails_enabled ? 'pending' : 'off',
      email_baker_sent: s.emails_enabled ? 'pending' : 'off'
    };
    // One write: set the row's formats and values together just below the last row.
    rowIndex = sh.getLastRow() + 1;
    if (rowIndex > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    var range = sh.getRange(rowIndex, 1, 1, header.length);
    range.setNumberFormats([orderRowFormats_(header)]);
    range.setValues([header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; })]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  clearConfigCache_();

  // 5. Send the emails now, outside the lock. A failure here must not lose the
  // order: the row stays 'pending' or shows FAILED, and sendPendingEmails()
  // (if put on a timer) retries anything still pending.
  var summary = orderSummary_(o);
  if (s.emails_enabled) {
    var ctx = { order: o, settings: s, summary: summary };
    markEmail_(rowIndex, header, 'email_customer_sent', trySend_(sendCustomerEmail_, ctx, o.order_number, 'customer'));
    markEmail_(rowIndex, header, 'email_baker_sent', trySend_(sendBakerEmail_, ctx, o.order_number, 'baker'));
  }

  // 6. Response for the done screen.
  return {
    ok: true,
    order_number: o.order_number,
    pickup_date: o.pickup_date,
    slot: o.slot,
    total: o.total,
    summary: summary,
    store: o.store,
    email: o.email
  };
}

/**
 * Returns { order } or { error, field, log }.
 * Never trusts prices or totals from the page.
 */
function validateOrder_(b, s) {
  function str(v, max) { return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''; }
  function bad(field, error, log) { return { error: error, field: field, log: log || error }; }
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  var store = find(s.stores, b.store);
  if (!store) return bad('store', 'Please choose a store to collect from.', 'invalid store');

  var quantity = Number(b.quantity);
  if (!isFinite(quantity) || Math.floor(quantity) !== quantity || quantity < 1 || quantity > s.max_quantity) {
    return bad('quantity', 'Please choose between 1 and ' + s.max_quantity + ' cakes.', 'invalid quantity');
  }

  var pickup = toIso_(b.pickup_date);
  if (!pickup) return bad('pickup_date', 'Please choose a pickup date.', 'invalid pickup date');
  var earliest = addDaysIso_(todayIso_(), s.lead_days);
  if (pickup < earliest || pickup > s.last_pickup_date) {
    return bad('pickup_date', 'Please choose a pickup date between ' + shortDate_(earliest) +
      ' and ' + shortDate_(s.last_pickup_date) + '.', 'pickup date outside window: ' + pickup);
  }
  var slot = s.slots.length === 1 ? s.slots[0] : find(s.slots, b.slot);
  if (!slot) return bad('slot', 'Please choose a collection time.', 'invalid slot');

  var name = str(b.name, 100);
  if (name.length < 2) return bad('name', 'Please enter your full name.', 'missing name');

  var cell = normaliseCell_(b.cell);
  if (!cell) return bad('cell', 'Please enter a South African cell number, like 082 123 4567.', 'invalid cell');

  var email = str(b.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return bad('email', 'Please enter a valid email address.', 'invalid email');
  }

  var notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) : '';

  if (b.consent !== true) {
    return bad('consent', 'Please tick the box to agree to us using your details for this order.', 'no consent');
  }

  var source = str(b.src, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');

  var unit = s.product_price; // null while the price is not set
  var total = unit === null ? null : unit * quantity;

  return {
    order: {
      product: s.product_name, store: store,
      quantity: quantity, unit_price: unit, total: total,
      pickup_date: pickup, slot: slot,
      name: name, cell: cell, email: email, notes: notes, source: source
    }
  };
}

/** Number formats for one Orders row, in header order (new rows don't always inherit column formats). */
function orderRowFormats_(header) {
  var formats = {
    created_at: 'yyyy-mm-dd hh:mm',
    pickup_date: 'ddd yyyy-mm-dd',
    cell: '@',
    total: '"R"#,##0'
  };
  return header.map(function (h) { return formats[h] || 'General'; });
}

/** Accepts 082 123 4567, 0821234567, +27 82 123 4567, 27821234567. Returns 0821234567 or ''. */
function normaliseCell_(v) {
  if (typeof v !== 'string') return '';
  var t = v.replace(/[\s\-().]/g, '');
  if (/^\+27/.test(t)) t = '0' + t.slice(3);
  else if (/^27\d{9}$/.test(t)) t = '0' + t.slice(2);
  return /^0[6-8]\d{8}$/.test(t) ? t : '';
}

/** Lines for the done screen and emails: [{label, value}] */
function orderSummary_(o) {
  var lines = [
    { label: 'Cake', value: o.product },
    { label: 'Quantity', value: String(o.quantity) }
  ];
  if (o.unit_price !== null && o.quantity > 1) lines.push({ label: 'Price per cake', value: money_(o.unit_price) });
  if (o.notes) lines.push({ label: 'Note', value: o.notes });
  return lines;
}

function closedMessage_(s) {
  return 'Orders for Christmas ' + s.last_pickup_date.slice(0, 4) + ' are closed.';
}

/** Stops a value being read as a formula when written to the sheet. */
function cellText_(v) {
  var t = String(v === undefined || v === null ? '' : v);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function rateLimitOk_(email) {
  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email);
  var key = 'rl:' + Utilities.base64EncodeWebSafe(digest).slice(0, 40);
  var count = Number(cache.get(key)) || 0;
  if (count >= RATE_LIMIT_MAX) return false;
  cache.put(key, String(count + 1), RATE_LIMIT_WINDOW_S);
  return true;
}

/* ---------- Sending emails after the order is saved ---------- */

/** Reads the Orders tab. Returns { sh, header, data } where data[0] is the header row. */
function readOrders_() {
  var sh = sheet_(SHEETS.ORDERS);
  var data = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), sh.getLastColumn()).getValues();
  var header = data[0].map(function (h) { return String(h).trim(); });
  return { sh: sh, header: header, data: data };
}

/** Rebuilds the order details the emails need from a saved Orders row. */
function orderFromRow_(row, header, s) {
  function v(name) { var i = header.indexOf(name); return i === -1 ? '' : row[i]; }
  var slotText = String(v('pickup_slot'));
  var slot = s.slots.filter(function (x) { return slotText === x.label + ' ' + x.start + '–' + x.end; })[0] || s.slots[0];
  var storeText = String(v('store'));
  var store = s.stores.filter(function (x) { return x.name === storeText || x.id === storeText; })[0] ||
    { id: storeText, name: storeText, address: '' };
  var quantity = Number(v('quantity')) || 1;
  var total = v('total') === '' ? null : Number(v('total'));
  return {
    order_number: String(v('order_number')),
    pickup_date: toIso_(v('pickup_date')),
    slot: slot, store: store, product: String(v('product')),
    quantity: quantity, total: total, unit_price: total === null ? null : total / quantity,
    name: String(v('name')), cell: String(v('cell')), email: String(v('email')),
    notes: String(v('notes')), source: String(v('source'))
  };
}

/**
 * Sends the emails for one order, once. Safe to call repeatedly: a row is
 * claimed (pending -> sending) under the lock, so nothing is sent twice.
 */
function sendOrderEmails_(orderNumber) {
  if (!/^MD-\d{4,}$/.test(String(orderNumber || ''))) return fail_('Unknown order.');
  var s = readSettings_();
  var claimed = claimPending_(function (num) { return num === orderNumber; });
  claimed.forEach(function (c) { sendClaimed_(c, s); });
  return { ok: true };
}

/** Run on a time-driven trigger (every 5 minutes) to send any emails the page missed. */
function sendPendingEmails() {
  var s = readSettings_();
  if (!s.emails_enabled) return;
  var cutoff = new Date(Date.now() - 60 * 1000); // leave very new orders to the page's own request
  var claimed = claimPending_(function (num, created) { return !(created instanceof Date) || created < cutoff; });
  claimed.forEach(function (c) { sendClaimed_(c, s); });
}

function claimPending_(match) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return [];
  var out = [];
  try {
    var t = readOrders_();
    var iNum = t.header.indexOf('order_number'), iCreated = t.header.indexOf('created_at');
    var iCust = t.header.indexOf('email_customer_sent'), iBaker = t.header.indexOf('email_baker_sent');
    for (var r = 1; r < t.data.length; r++) {
      var row = t.data[r];
      var who = [];
      if (row[iCust] === 'pending') who.push('customer');
      if (row[iBaker] === 'pending') who.push('baker');
      if (!who.length || !match(String(row[iNum]), row[iCreated])) continue;
      who.forEach(function (w) {
        t.sh.getRange(r + 1, (w === 'customer' ? iCust : iBaker) + 1).setValue('sending');
      });
      out.push({ rowIndex: r + 1, row: row, header: t.header, who: who });
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return out;
}

function sendClaimed_(c, s) {
  var o = orderFromRow_(c.row, c.header, s);
  var ctx = { order: o, settings: s, summary: orderSummary_(o) };
  if (c.who.indexOf('customer') !== -1) {
    markEmail_(c.rowIndex, c.header, 'email_customer_sent', trySend_(sendCustomerEmail_, ctx, o.order_number, 'customer'));
  }
  if (c.who.indexOf('baker') !== -1) {
    markEmail_(c.rowIndex, c.header, 'email_baker_sent', trySend_(sendBakerEmail_, ctx, o.order_number, 'baker'));
  }
}

function trySend_(fn, ctx, orderNumber, who) {
  try {
    fn(ctx);
    return 'sent ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  } catch (err) {
    if (err && err.message === 'SKIP') return 'no recipients';
    log_('ERROR', 'Email to ' + who + ' failed for ' + orderNumber + ': ' + (err && err.message));
    alert_('Email failed for ' + orderNumber,
      'The order was saved but the ' + who + ' email failed:\n\n' + (err && err.message));
    return 'FAILED';
  }
}

function markEmail_(rowIndex, header, column, value) {
  try {
    var col = header.indexOf(column) + 1;
    if (col > 0) sheet_(SHEETS.ORDERS).getRange(rowIndex, col).setValue(value);
  } catch (err) {
    log_('ERROR', 'Could not record email status: ' + (err && err.message));
  }
}
