/**
 * Per-date availability for the bookable window.
 * Capacity is counted in cakes (sum of quantity), not orders.
 */

/** { 'yyyy-MM-dd': cakesBooked } from the Orders tab, ignoring cancelled orders. */
function bookedByDate_() {
  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var booked = {};
  if (last < 2) return booked;

  var data = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = data[0].map(function (h) { return String(h).trim(); });
  var iDate = header.indexOf('pickup_date');
  var iQty = header.indexOf('quantity');
  var iStatus = header.indexOf('status');
  if (iDate === -1 || iQty === -1) throw settingsError_('Orders tab is missing pickup_date or quantity column');

  for (var r = 1; r < data.length; r++) {
    var status = iStatus === -1 ? '' : String(data[r][iStatus]).trim().toLowerCase();
    if (status === 'cancelled') continue;
    var iso = toIso_(data[r][iDate]);
    var qty = Number(data[r][iQty]) || 0;
    if (iso && qty > 0) booked[iso] = (booked[iso] || 0) + qty;
  }
  return booked;
}

/** Optional Capacity tab: date | max. Returns { 'yyyy-MM-dd': max }. */
function capacityOverrides_() {
  var sh = ss_().getSheetByName(SHEETS.CAPACITY);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (row) {
    var iso = toIso_(row[0]);
    var max = Number(row[1]);
    if (iso && String(row[1]).trim() !== '' && isFinite(max) && max >= 0) out[iso] = Math.floor(max);
  });
  return out;
}

/**
 * [{date, remaining, status: open|few|full|closed}] from today + lead_days
 * through last_pickup_date.
 */
function computeAvailability_(s, booked, overrides, today) {
  var out = [];
  var start = addDaysIso_(today, s.lead_days);
  for (var d = start; d <= s.last_pickup_date; d = addDaysIso_(d, 1)) {
    var max = Object.prototype.hasOwnProperty.call(overrides, d) ? overrides[d] : s.daily_capacity;
    var closed = max <= 0 ||
      s.closed_dates.indexOf(d) !== -1 ||
      s.closed_weekdays.indexOf(weekdayIso_(d)) !== -1;
    var remaining = closed ? 0 : Math.max(0, max - (booked[d] || 0));
    var status = closed ? 'closed'
      : remaining <= 0 ? 'full'
      : remaining <= s.few_left_threshold ? 'few'
      : 'open';
    out.push({ date: d, remaining: remaining, status: status });
  }
  return out;
}
