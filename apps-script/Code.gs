/**
 * @OnlyCurrentDoc
 * Limits the script to the sheet it is attached to (not all of the owner's sheets).
 */

/**
 * Motherdough Christmas fruitcake pre-order API (Apps Script web app).
 *
 *   GET  ?action=config  -> product, price, stores, collection times, cut-off state, availability
 *   POST (text/plain JSON body) -> place an order
 *
 * The page must POST with Content-Type: text/plain so the browser does not send
 * a CORS preflight (Apps Script web apps cannot answer one).
 *
 * See CLAUDE.md for the full spec.
 */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'config') return json_(getConfig_());
    return json_(fail_('Unknown action.'));
  } catch (err) {
    return json_(handleUnexpected_(err, 'doGet'));
  }
}

function doPost(e) {
  try {
    var body = null;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (parseErr) {
      body = null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      log_('WARN', 'Rejected order: request body was not a JSON object');
      return json_(fail_('Sorry, something went wrong sending your order. Please try again.'));
    }
    if (body.action === 'send_emails') return json_(sendOrderEmails_(body.order_number));
    return json_(placeOrder_(body));
  } catch (err) {
    return json_(handleUnexpected_(err, 'doPost'));
  }
}

var CONFIG_CACHE_KEY = 'config_v1';
var CONFIG_CACHE_S = 120; // Settings changes show on the page within 2 minutes

function clearConfigCache_() {
  try { CacheService.getScriptCache().remove(CONFIG_CACHE_KEY); } catch (e) { /* ignore */ }
}

/** Config for the page, cached briefly so most page loads skip reading the sheet. */
function getConfig_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) {
    var cfg = JSON.parse(hit);
    if (cfg.today === todayIso_()) return cfg;
  }
  var fresh = buildConfig_();
  try { cache.put(CONFIG_CACHE_KEY, JSON.stringify(fresh), CONFIG_CACHE_S); } catch (e) { /* too big: skip */ }
  return fresh;
}

/** Builds the public config the page needs. No customer data in here. */
function buildConfig_() {
  var s = readSettings_();
  var today = todayIso_();
  var availability = computeAvailability_(s, bookedByDate_(), capacityOverrides_(), today);
  var bookable = availability.some(function (d) { return d.status === 'open' || d.status === 'few'; });
  var open = today <= s.last_order_date && availability.length > 0;

  return {
    ok: true,
    today: today,
    ordering_open: open,
    sold_out: open && !bookable,
    season_year: Number(s.last_pickup_date.slice(0, 4)),
    lead_days: s.lead_days,
    last_order_date: s.last_order_date,
    last_pickup_date: s.last_pickup_date,
    few_left_threshold: s.few_left_threshold,
    max_quantity: s.max_quantity,
    product: { name: s.product_name, price: s.product_price },
    slots: s.slots,
    stores: s.stores,
    shop_phone: s.shop_phone,
    availability: open ? availability : []
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, extra) {
  var out = { ok: false, error: message };
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}
