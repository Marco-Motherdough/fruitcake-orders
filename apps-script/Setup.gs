/**
 * One-time setup. Open the bound script editor, select setup, and Run.
 * Safe to run again: it creates missing tabs and rows but never overwrites
 * values staff have already filled in.
 */

var SETTINGS_DEFAULTS = [
  // key, placeholder value, note for staff. '' = TBD, must be filled before launch.
  ['lead_days', 14, 'Earliest pickup = today + this many days (Johannesburg time).'],
  ['last_order_date', '2026-12-10', 'TBD confirm. Last day orders are accepted (yyyy-mm-dd).'],
  ['last_pickup_date', '2026-12-24', 'TBD confirm. Last pickup date (yyyy-mm-dd).'],
  ['daily_capacity', '', 'TBD. Max cakes (not orders) per pickup date. Per-date overrides go in the Capacity tab.'],
  ['few_left_threshold', 3, 'Show the "few left" dot when this many or fewer cakes remain.'],
  ['max_quantity', 5, 'Max cakes per order.'],
  ['closed_dates', '', 'TBD. Comma-separated yyyy-mm-dd dates with no pickups, e.g. 2026-12-16, 2026-12-20'],
  ['closed_weekdays', '', 'TBD. Comma-separated weekdays with no pickups, e.g. Sun, Mon'],
  ['slots', JSON.stringify([
    { id: 'morning', label: 'Morning', start: '07:30', end: '11:00' },
    { id: 'midday', label: 'Midday', start: '11:00', end: '13:30' },
    { id: 'afternoon', label: 'Afternoon', start: '13:30', end: '16:00' }
  ]), 'TBD confirm. Collection time slots (JSON).'],
  ['store_name', '', 'TBD. Pickup store name.'],
  ['store_address', '', 'TBD. Pickup store address.'],
  ['shop_phone', '', 'TBD. Shown to customers if something goes wrong.'],
  ['baker_emails', '', 'TBD. Comma-separated addresses that get the new-order email.'],
  ['alert_email', '', 'Gets error alerts. Blank = the script owner account.'],
  ['from_name', 'Motherdough', 'Sender name on emails.'],
  ['reply_to', '', 'Reply-to address on customer emails.'],
  ['order_counter', 0, 'Last order number used. Do not edit during the season.'],
  ['options_json', JSON.stringify({
    sizes: [
      { id: '500g', label: '500 g', price: 220 },
      { id: '1kg', label: '1 kg', price: 380 },
      { id: '2kg', label: '2 kg', price: 680 }
    ],
    soaks: [
      { id: 'brandy', label: 'Brandy', price: 0 },
      { id: 'alcohol_free', label: 'Alcohol-free', price: 0 }
    ],
    finishes: [
      { id: 'apricot', label: 'Plain apricot glaze', price: 0 },
      { id: 'marzipan', label: 'Marzipan', price: 60 },
      { id: 'marzipan_icing', label: 'Marzipan and royal icing', price: 95 }
    ],
    extras: [
      { id: 'gift_box', label: 'Gift box with ribbon', price: 45 }
    ]
  }, null, 1), 'TBD real prices. Options and prices in rand (JSON). Extras are charged per cake.']
];

function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);

  // Orders
  var orders = ensureSheet_(ss, SHEETS.ORDERS, ORDER_COLUMNS);
  orders.setFrozenRows(1);
  var col = function (name) { return ORDER_COLUMNS.indexOf(name) + 1; };
  var rows = Math.max(orders.getMaxRows() - 1, 1);
  orders.getRange(2, col('created_at'), rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  orders.getRange(2, col('pickup_date'), rows, 1).setNumberFormat('ddd yyyy-mm-dd');
  orders.getRange(2, col('total'), rows, 1).setNumberFormat('"R"#,##0');
  orders.getRange(2, col('cell'), rows, 1).setNumberFormat('@');
  orders.getRange(1, 1, 1, ORDER_COLUMNS.length).setFontWeight('bold');

  // Settings
  var settings = ensureSheet_(ss, SHEETS.SETTINGS, ['key', 'value', 'notes']);
  settings.setFrozenRows(1);
  settings.getRange('B:B').setNumberFormat('@'); // keep dates and JSON as plain text
  var existing = {};
  if (settings.getLastRow() > 1) {
    settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { existing[String(r[0]).trim()] = true; });
  }
  SETTINGS_DEFAULTS.forEach(function (row) {
    if (!existing[row[0]]) settings.appendRow([row[0], String(row[1]), row[2]]);
  });
  settings.getRange(1, 1, 1, 3).setFontWeight('bold');
  settings.setColumnWidth(1, 170);
  settings.setColumnWidth(2, 320);

  // Capacity overrides (optional)
  var cap = ensureSheet_(ss, SHEETS.CAPACITY, ['date', 'max']);
  cap.setFrozenRows(1);
  cap.getRange('A:A').setNumberFormat('yyyy-mm-dd');

  // Log
  var log = ensureSheet_(ss, SHEETS.LOG, ['timestamp', 'level', 'message']);
  log.setFrozenRows(1);
  log.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  log_('INFO', 'setup() ran');
  checkSettings();
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

/** Run from the editor to see whether Settings are complete. */
function checkSettings() {
  try {
    readSettings_();
    console.log('Settings look complete.');
    return 'Settings look complete.';
  } catch (err) {
    console.log(err.message);
    return err.message;
  }
}

/** Run from the editor to preview the config the page will receive. */
function previewConfig() {
  console.log(JSON.stringify(getConfig_(), null, 2));
}
