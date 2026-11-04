/**
 * Reading and parsing the Settings tab. Every business value lives there so
 * staff can change it without touching code.
 */

var TZ = 'Africa/Johannesburg';

var SHEETS = {
  ORDERS: 'Orders',
  SETTINGS: 'Settings',
  LOG: 'Log',
  CAPACITY: 'Capacity'
};

var ORDER_COLUMNS = [
  'order_number', 'created_at', 'status', 'pickup_date', 'pickup_slot', 'store',
  'name', 'cell', 'email', 'size', 'soak', 'finish', 'gift_box', 'quantity',
  'notes', 'total', 'consent', 'source', 'email_customer_sent', 'email_baker_sent'
];

var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw settingsError_('Missing sheet tab "' + name + '". Run setup().');
  return sh;
}

function settingsError_(message) {
  var err = new Error(message);
  err.isSettingsError = true;
  return err;
}

/** Raw key -> value map from the Settings tab (columns A and B, header in row 1). */
function readSettingsRaw_() {
  var sh = sheet_(SHEETS.SETTINGS);
  var last = sh.getLastRow();
  var raw = {};
  if (last < 2) return raw;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (row) {
    var key = String(row[0]).trim();
    if (key) raw[key] = row[1];
  });
  return raw;
}

/** Parsed, validated settings. Throws a settings error if something required is missing. */
function readSettings_() {
  return parseSettings_(readSettingsRaw_());
}

function parseSettings_(raw) {
  var problems = [];

  function text(key) {
    var v = raw[key];
    return v === undefined || v === null ? '' : String(v).trim();
  }
  function int(key, fallback, required) {
    var t = text(key);
    if (t === '') {
      if (required) problems.push(key + ' is empty');
      return fallback;
    }
    var n = Number(t);
    if (!isFinite(n) || Math.floor(n) !== n || n < 0) {
      problems.push(key + ' must be a whole number');
      return fallback;
    }
    return n;
  }
  function date(key) {
    var iso = toIso_(raw[key]);
    if (!iso) problems.push(key + ' must be a date like 2026-12-10');
    return iso;
  }
  function list(key) {
    return text(key).split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(String);
  }
  function jsonVal(key) {
    var t = text(key);
    if (!t) { problems.push(key + ' is empty'); return null; }
    try { return JSON.parse(t); } catch (e) { problems.push(key + ' is not valid JSON'); return null; }
  }

  var s = {
    lead_days: int('lead_days', 14, true),
    last_order_date: date('last_order_date'),
    last_pickup_date: date('last_pickup_date'),
    daily_capacity: int('daily_capacity', 0, true),
    few_left_threshold: int('few_left_threshold', 3, false),
    max_quantity: int('max_quantity', 5, false),
    closed_dates: [],
    closed_weekdays: [],
    slots: [],
    store_name: text('store_name'),
    store_address: text('store_address'),
    shop_phone: text('shop_phone'),
    baker_emails: list('baker_emails'),
    alert_email: text('alert_email'),
    from_name: text('from_name') || 'Motherdough',
    reply_to: text('reply_to'),
    options: null
  };

  // closed_dates may be a single date cell or a comma-separated list.
  if (raw.closed_dates instanceof Date) {
    s.closed_dates = [toIso_(raw.closed_dates)];
  } else {
    list('closed_dates').forEach(function (d) {
      var iso = toIso_(d);
      if (iso) s.closed_dates.push(iso);
      else problems.push('closed_dates has an invalid date: ' + d);
    });
  }

  list('closed_weekdays').forEach(function (w) {
    var i = WEEKDAYS.indexOf(w.slice(0, 3).toLowerCase());
    if (i === -1) problems.push('closed_weekdays has an unknown day: ' + w);
    else s.closed_weekdays.push(i);
  });

  if (!s.store_name) problems.push('store_name is empty');
  if (!s.store_address) problems.push('store_address is empty');
  if (!s.baker_emails.length) problems.push('baker_emails is empty');
  if (s.max_quantity < 1) s.max_quantity = 1;

  var slots = jsonVal('slots');
  if (slots) {
    if (!Array.isArray(slots) || !slots.length) problems.push('slots must be a non-empty JSON list');
    else s.slots = slots.map(function (x) {
      return { id: String(x.id), label: String(x.label), start: String(x.start), end: String(x.end) };
    });
  }

  var opts = jsonVal('options_json');
  if (opts) {
    s.options = {
      sizes: normaliseOptions_(opts.sizes, 'sizes', problems),
      soaks: normaliseOptions_(opts.soaks, 'soaks', problems),
      finishes: normaliseOptions_(opts.finishes, 'finishes', problems),
      extras: normaliseOptions_(opts.extras || [], 'extras', problems, true)
    };
  }

  if (problems.length) throw settingsError_('Settings problem: ' + problems.join('; '));
  return s;
}

function normaliseOptions_(arr, name, problems, allowEmpty) {
  if (!Array.isArray(arr) || (!arr.length && !allowEmpty)) {
    problems.push('options_json.' + name + ' must be a non-empty list');
    return [];
  }
  return arr.map(function (o) {
    var price = Number(o.price || 0);
    if (!o.id || !o.label || !isFinite(price) || price < 0) {
      problems.push('options_json.' + name + ' has an invalid entry');
    }
    var out = { id: String(o.id), label: String(o.label), price: price };
    if (o.note) out.note = String(o.note);
    return out;
  });
}

/** Increments order_counter. Call only while holding the script lock. */
function nextOrderNumber_() {
  var sh = sheet_(SHEETS.SETTINGS);
  var values = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'order_counter') {
      var n = (parseInt(values[i][1], 10) || 0) + 1;
      sh.getRange(i + 1, 2).setValue(n);
      return 'MD-' + ('000' + n).slice(-Math.max(4, String(n).length));
    }
  }
  throw settingsError_('Settings row "order_counter" is missing');
}

/* ---------- Dates (all as yyyy-MM-dd strings in Johannesburg time) ---------- */

function todayIso_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function toIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '';
  var p = t.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2] ? t : '';
}

function addDaysIso_(iso, n) {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

function weekdayIso_(iso) {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

/** A Date at local midnight, for writing to the sheet as a real date. */
function isoToSheetDate_(iso) {
  var p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTH_NAMES_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "Sat 19 Dec" */
function shortDate_(iso) {
  var p = iso.split('-').map(Number);
  return DAY_NAMES[weekdayIso_(iso)] + ' ' + p[2] + ' ' + MONTH_NAMES[p[1] - 1];
}

/** "Saturday 19 December 2026" */
function longDate_(iso) {
  var p = iso.split('-').map(Number);
  return DAY_NAMES_LONG[weekdayIso_(iso)] + ' ' + p[2] + ' ' + MONTH_NAMES_LONG[p[1] - 1] + ' ' + p[0];
}

/** "R1 360" */
function money_(n) {
  var whole = Math.round(n);
  return 'R' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
