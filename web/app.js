/* Motherdough Christmas fruitcake pre-order page. Vanilla JS, no build step. */
(function () {
  'use strict';

  var CONFIG = {
    // Apps Script web app URL (Deploy > Manage deployments). Stays the same across new versions.
    API_URL: 'https://script.google.com/macros/s/AKfycbx6IzIM80uFVI_BOEOsq09xjYxFARJAM1SCMC4KeM_Jhx2OrWGX0_FhOQY1UeRMtJCZ_g/exec',
    // TBD: shop phone number, shown if the order system cannot be reached.
    SHOP_PHONE: '',
    REQUEST_TIMEOUT_MS: 20000
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var STEP_NAMES = ['CAKE', 'PICKUP', 'DETAILS', 'DONE'];

  var state = {
    config: null,
    step: 0,
    store: null,
    quantity: 1,
    date: null,
    slot: null,
    viewMonth: null, // 'yyyy-MM'
    submitting: false,
    result: null,
    src: readSrc()
  };

  function $(id) { return document.getElementById(id); }

  /* ---------- Helpers ---------- */

  function readSrc() {
    try {
      var v = new URLSearchParams(window.location.search).get('src') || '';
      return v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    } catch (e) { return ''; }
  }

  function money(n) {
    return 'R' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  }

  function parts(iso) { return iso.split('-').map(Number); }
  function weekday(iso) { var p = parts(iso); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function longDate(iso) { var p = parts(iso); return DAYS[weekday(iso)] + ' ' + p[2] + ' ' + MONTHS[p[1] - 1]; }
  function shortDate(iso) { var p = parts(iso); return DAYS_SHORT[weekday(iso)] + ' ' + p[2] + ' ' + MONTHS_SHORT[p[1] - 1]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else if (attrs[k] === true) node.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function phone() { return (state.config && state.config.shop_phone) || CONFIG.SHOP_PHONE; }

  /* ---------- Preview mode (until the Apps Script URL is set) ---------- */

  var DEMO = CONFIG.API_URL.indexOf('REPLACE_WITH') !== -1;

  function demoIso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function demoConfig() {
    var now = new Date();
    var year = now.getMonth() === 11 && now.getDate() > 24 ? now.getFullYear() + 1 : now.getFullYear();
    var last = year + '-12-24';
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
    var availability = [];
    for (var d = new Date(start), i = 0; demoIso(d) <= last; d.setDate(d.getDate() + 1), i++) {
      var status = 'open', remaining = 20;
      if (i === 3) { status = 'few'; remaining = 2; }
      if (i === 5) { status = 'full'; remaining = 0; }
      availability.push({ date: demoIso(d), remaining: remaining, status: status });
    }
    return {
      ok: true, demo: true, today: demoIso(now), ordering_open: availability.length > 0, sold_out: false,
      season_year: year, lead_days: 14, last_order_date: year + '-12-10', last_pickup_date: last,
      few_left_threshold: 3, max_quantity: 5,
      product: { name: 'Rich Dark Fruitcake 700g', price: null },
      slots: [{ id: 'day', label: 'Any time', start: '08:00', end: '16:00' }],
      stores: [{ id: 'FHK', name: 'FHK', address: '' }, { id: 'JHK', name: 'JHK', address: '' }, { id: 'STB', name: 'STB', address: '' }],
      shop_phone: '', availability: availability
    };
  }

  function demoRequest(method, body) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (method === 'GET') return resolve(demoConfig());
        var store = find(state.config.stores, body.store);
        resolve({
          ok: true, order_number: 'MD-DEMO', pickup_date: body.pickup_date, slot: state.config.slots[0],
          total: null, email: body.email, store: store,
          summary: [{ label: 'Cake', value: state.config.product.name }, { label: 'Quantity', value: String(body.quantity) }]
            .concat(body.notes ? [{ label: 'Note', value: body.notes }] : [])
        });
      }, method === 'GET' ? 300 : 1200);
    });
  }

  function request(method, body, keepalive) {
    if (DEMO) return demoRequest(method, body);
    var url = CONFIG.API_URL + (method === 'GET' ? '?action=config&_=' + Date.now() : '');
    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CONFIG.REQUEST_TIMEOUT_MS) : null;
    var opts = { method: method, redirect: 'follow', signal: controller ? controller.signal : undefined, keepalive: !!keepalive };
    if (body) {
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight.
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify(body);
    }
    lastCall = Date.now();
    return fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- Warm-up ---------- */

  // Google's script goes to sleep after a short idle time and takes a few seconds
  // to wake. Wake it while the customer fills in step 3, so PLACE ORDER is quick.
  var lastCall = 0;
  function warmUp() {
    if (DEMO || state.submitting || Date.now() - lastCall < 45000) return;
    lastCall = Date.now();
    request('GET').then(function (cfg) {
      if (cfg && cfg.ok && cfg.ordering_open && !state.submitting && !state.result) {
        state.config.availability = cfg.availability; // fresher dates, checked again on submit
      }
    }).catch(function () { /* ignore: the order itself will report any problem */ });
  }

  /* ---------- Loading config ---------- */

  // Shown straight away so step 1 appears instantly; replaced when the real
  // config arrives (product name, price, stores and dates come from the sheet).
  var STARTUP_CONFIG = {
    startup: true,
    product: { name: 'Rich Dark Fruitcake 700g', price: null },
    max_quantity: 5,
    availability: [], slots: [], stores: []
  };

  function loadConfig() {
    state.config = STARTUP_CONFIG;
    renderCakeOptions();
    goToStep(1, 'replace');

    return request('GET').then(function (cfg) {
      if (!cfg || !cfg.ok) throw new Error((cfg && cfg.error) || 'Bad config');
      state.config = cfg;
      if (!cfg.ordering_open) return showClosed('Orders for Christmas ' + cfg.season_year + ' are closed',
        'Thank you for your support this season.');
      if (cfg.sold_out) return showClosed('We’re fully booked',
        'Every pickup date for Christmas ' + cfg.season_year + ' is full. Thank you for your support.');
      renderCakeOptions();
      renderPickupStatic();
      if (state.waitingForDates) {
        state.waitingForDates = false;
        setDatesButton(false);
        goToStep(2, 'push');
      }
    }).catch(function () {
      state.waitingForDates = false;
      setDatesButton(false);
      showState('error');
    });
  }

  function setDatesButton(loading) {
    var b = $('to-step-2');
    b.disabled = loading;
    b.textContent = loading ? 'Loading dates…' : 'Choose pickup date';
  }

  function showState(which) {
    ['loading', 'error', 'closed'].forEach(function (s) { $('state-' + s).hidden = s !== which; });
    if (which) {
      for (var i = 1; i <= 4; i++) $('step-' + i).hidden = true;
      $('step-nav').hidden = true;
      state.step = 0;
    }
    if (which === 'error') {
      var p = phone();
      document.querySelectorAll('.js-phone-sentence').forEach(function (n) { n.hidden = !p; });
      document.querySelectorAll('.js-phone-link').forEach(function (a) {
        a.textContent = p;
        a.href = 'tel:' + p.replace(/[^\d+]/g, '');
      });
    }
    var h = which && $('state-' + which).querySelector('.heading');
    if (h) h.focus();
  }

  function showClosed(title, text) {
    $('closed-heading').textContent = title;
    $('closed-text').textContent = text;
    showState('closed');
  }

  /* ---------- Step 1: cake ---------- */

  function renderCakeOptions() {
    state.quantity = Math.min(state.quantity, state.config.max_quantity);
    $('h-step-1').textContent = state.config.product.name;
    $('intro-text').textContent = state.config.startup ? 'Baked to order.' :
      'Baked to order. Collect from ' + shortDate(firstDate()) +
      ' to ' + shortDate(state.config.last_pickup_date) + '. Order by ' +
      shortDate(state.config.last_order_date) + '.';
    document.querySelectorAll('.js-price').forEach(function (n) { n.hidden = !hasPrice(); });
    updateQuantity();
  }

  function firstDate() {
    var a = state.config.availability;
    return a.length ? a[0].date : state.config.last_pickup_date;
  }

  function hasPrice() { var p = state.config.product.price; return typeof p === 'number'; }

  function total() { return hasPrice() ? state.config.product.price * state.quantity : 0; }

  function updateTotals() {
    $('total-1').textContent = money(total());
    $('total-3').textContent = money(total());
  }

  function updateQuantity() {
    $('qty-value').textContent = state.quantity;
    $('qty-minus').disabled = state.quantity <= 1;
    $('qty-plus').disabled = state.quantity >= state.config.max_quantity;
    updateTotals();
  }

  /* ---------- Step 2: pickup ---------- */

  function renderPickupStatic() {
    var c = state.config;
    $('pickup-intro').textContent = 'We need at least ' + c.lead_days +
      ' days to bake your cake. Last collection is ' + longDate(c.last_pickup_date) + '.';

    if (c.stores.length === 1) state.store = c.stores[0].id;
    var stores = $('store-options');
    stores.textContent = '';
    c.stores.forEach(function (st) {
      var input = el('input', { type: 'radio', name: 'store', value: st.id });
      input.checked = state.store === st.id;
      input.addEventListener('change', function () { state.store = st.id; $('store-error').hidden = true; });
      stores.appendChild(el('label', { className: 'row' }, [
        input,
        el('span', { className: 'row-main' }, [st.name, st.address ? el('span', { className: 'row-sub', text: st.address }) : null])
      ]));
    });

    var single = c.slots.length === 1;
    $('slot-group').hidden = single;
    $('slot-single').hidden = !single;
    if (single) {
      state.slot = c.slots[0].id;
      $('slot-single-text').textContent = 'Any time from ' + c.slots[0].start.replace(/^0/, '') + ' to ' + c.slots[0].end.replace(/^0/, '') + ' on your collection day.';
    }

    var box = $('slot-options');
    box.textContent = '';
    c.slots.forEach(function (slot) {
      var input = el('input', { type: 'radio', name: 'slot', value: slot.id });
      input.checked = state.slot === slot.id;
      input.addEventListener('change', function () { state.slot = slot.id; $('slot-error').hidden = true; });
      box.appendChild(el('label', { className: 'row' }, [
        input,
        el('span', { className: 'row-main', text: slot.label }),
        el('span', { className: 'row-price', text: slotTime(slot) })
      ]));
    });
  }

  function slotTime(slot) {
    return slot.start.replace(/^0/, '') + '–' + slot.end.replace(/^0/, '');
  }

  function findStore(id) { return find(state.config.stores, id); }

  function availabilityMap() {
    var map = {};
    state.config.availability.forEach(function (d) { map[d.date] = d; });
    return map;
  }

  function isBookable(d) {
    return d && (d.status === 'open' || d.status === 'few') && d.remaining >= state.quantity;
  }

  function monthRange() {
    var a = state.config.availability;
    return { first: a[0].date.slice(0, 7), last: a[a.length - 1].date.slice(0, 7) };
  }

  function shiftMonth(ym, n) {
    var p = ym.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  function renderCalendar() {
    var map = availabilityMap();
    var range = monthRange();

    // Drop a selected date that is no longer bookable (e.g. quantity went up or date filled).
    if (state.date && !isBookable(map[state.date])) state.date = null;

    if (!state.viewMonth) {
      var firstOpen = state.config.availability.filter(isBookable)[0];
      state.viewMonth = (state.date || (firstOpen && firstOpen.date) || state.config.availability[0].date).slice(0, 7);
    }
    if (state.viewMonth < range.first) state.viewMonth = range.first;
    if (state.viewMonth > range.last) state.viewMonth = range.last;

    var p = state.viewMonth.split('-').map(Number);
    $('cal-month').textContent = MONTHS[p[1] - 1] + ' ' + p[0];
    $('cal-prev').disabled = state.viewMonth <= range.first;
    $('cal-next').disabled = state.viewMonth >= range.last;

    var body = $('cal-body');
    body.textContent = '';
    var daysInMonth = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    var lead = (new Date(Date.UTC(p[0], p[1] - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    var row = el('tr');
    for (var i = 0; i < lead; i++) row.appendChild(el('td'));

    for (var day = 1; day <= daysInMonth; day++) {
      var iso = state.viewMonth + '-' + pad(day);
      var info = map[iso];
      var bookable = isBookable(info);
      var classes = ['day'];
      var label = longDate(iso);
      if (info) {
        if (bookable) {
          classes.push('available');
          if (info.status === 'few') label += ', few left';
        } else {
          classes.push('unavailable');
          if (info.status === 'closed') label += ', closed';
          else if (info.status === 'full') label += ', full';
          else label += ', only ' + info.remaining + ' left, fewer than your quantity';
        }
      } else {
        label += ', not available';
      }
      if (iso === state.date) { classes.push('selected'); label += ', selected'; }

      var btn = el('button', {
        type: 'button', className: classes.join(' '), 'aria-label': label,
        'aria-pressed': iso === state.date ? 'true' : 'false', 'data-date': iso
      }, [String(day)]);
      btn.disabled = !bookable;
      if (bookable && info.status === 'few') btn.appendChild(el('span', { className: 'dot', 'aria-hidden': 'true' }));
      btn.addEventListener('click', onPickDate);
      row.appendChild(el('td', null, [btn]));

      if ((lead + day) % 7 === 0) { body.appendChild(row); row = el('tr'); }
    }
    if (row.childNodes.length) {
      while (row.childNodes.length < 7) row.appendChild(el('td'));
      body.appendChild(row);
    }
  }

  function onPickDate(e) {
    state.date = e.currentTarget.getAttribute('data-date');
    $('date-error').hidden = true;
    renderCalendar();
    var sel = document.querySelector('.day[data-date="' + state.date + '"]');
    if (sel) sel.focus();
  }

  /* ---------- Step 3: details ---------- */

  function renderSummary() {
    fillDl($('summary-cake'), [
      ['Cake', state.config.product.name],
      ['Quantity', String(state.quantity)]
    ]);

    var slot = find(state.config.slots, state.slot);
    fillDl($('summary-pickup'), [
      ['Date', shortDate(state.date)],
      ['Time', (state.config.slots.length === 1 ? '' : slot.label + ', ') + slotTime(slot)],
      ['Store', findStore(state.store).name]
    ]);
    updateTotals();
  }

  function fillDl(dl, lines) {
    dl.textContent = '';
    lines.forEach(function (l) {
      dl.appendChild(el('div', null, [el('dt', { text: l[0] }), el('dd', { text: l[1] })]));
    });
  }

  var CELL_RE = /^0[6-8]\d{8}$/;
  function normaliseCell(v) {
    var t = v.replace(/[\s\-().]/g, '');
    if (/^\+27/.test(t)) t = '0' + t.slice(3);
    else if (/^27\d{9}$/.test(t)) t = '0' + t.slice(2);
    return CELL_RE.test(t) ? t : '';
  }

  function validateDetails() {
    var checks = [
      ['f-name', 'e-name', $('f-name').value.trim().length >= 2],
      ['f-cell', 'e-cell', !!normaliseCell($('f-cell').value)],
      ['f-email', 'e-email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($('f-email').value.trim())],
      ['f-consent', 'e-consent', $('f-consent').checked]
    ];
    var firstBad = null;
    checks.forEach(function (c) {
      var ok = c[2];
      $(c[1]).hidden = ok;
      if (ok) $(c[0]).removeAttribute('aria-invalid');
      else { $(c[0]).setAttribute('aria-invalid', 'true'); if (!firstBad) firstBad = $(c[0]); }
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function fieldIdFor(serverField) {
    return { name: 'f-name', cell: 'f-cell', email: 'f-email', consent: 'f-consent' }[serverField];
  }

  function setSubmitting(on) {
    state.submitting = on;
    var b = $('place-order');
    b.disabled = on;
    b.textContent = on ? 'Placing your order…' : 'Place order';
  }

  function showSubmitError(msg) {
    var box = $('submit-error');
    box.textContent = msg;
    box.hidden = false;
    box.scrollIntoView({ block: 'center' });
  }

  function onSubmit(e) {
    e.preventDefault();
    if (state.submitting) return;
    $('submit-error').hidden = true;
    if (!validateDetails()) return;

    var payload = {
      store: state.store,
      quantity: state.quantity,
      pickup_date: state.date,
      slot: state.slot,
      name: $('f-name').value.trim(),
      cell: $('f-cell').value.trim(),
      email: $('f-email').value.trim(),
      notes: $('f-notes').value.trim(),
      consent: $('f-consent').checked,
      website: $('f-website').value,
      src: state.src
    };

    setSubmitting(true);
    request('POST', payload).then(function (res) {
      setSubmitting(false);
      if (res && res.ok) {
        state.result = res;
        if (res.emails_pending) {
          // Ask the script to send the emails now that the order is saved.
          // keepalive lets it finish even if the customer closes the page.
          request('POST', { action: 'send_emails', order_number: res.order_number }, true).catch(function () {});
        }
        renderDone();
        goToStep(4, 'push');
        return;
      }
      var code = res && res.code;
      var msg = (res && res.error) || 'Sorry, something went wrong. Your order has not been placed.';
      if ((code === 'date_full' || code === 'date_unavailable') && res.availability) {
        state.config.availability = res.availability;
        state.date = null;
        $('date-message').textContent = msg;
        $('date-message').hidden = false;
        goToStep(2, 'push');
        return;
      }
      if (code === 'closed') {
        showClosed(msg, 'Thank you for your support this season.');
        return;
      }
      if (code === 'invalid' && res.field) {
        var fid = fieldIdFor(res.field);
        if (fid) $(fid).setAttribute('aria-invalid', 'true');
      }
      if (code === 'server_error' && phone()) msg += ' Please try again, or call us on ' + phone() + '.';
      showSubmitError(msg);
    }).catch(function () {
      setSubmitting(false);
      showSubmitError('We could not reach our order system, so we can’t be sure your order went through. ' +
        'Please check your email for a confirmation before trying again' +
        (phone() ? ', or call us on ' + phone() : '') + '.');
    });
  }

  /* ---------- Step 4: done ---------- */

  function renderDone() {
    var r = state.result;
    $('h-step-4').textContent = 'Thank you, ' + $('f-name').value.trim().split(' ')[0];
    $('done-email').textContent = r.email;
    $('done-number').textContent = r.order_number;
    $('done-date').textContent = longDate(r.pickup_date);
    $('done-slot').textContent = (state.config.slots.length === 1 ? 'Any time ' : r.slot.label + ', ') + slotTime(r.slot);
    $('done-store').textContent = r.store.name;
    $('done-address').textContent = r.store.address;
    $('done-address-wrap').hidden = !r.store.address;
    fillDl($('done-summary'), r.summary.map(function (l) { return [l.label, l.value]; }));
    $('done-total-row').hidden = typeof r.total !== 'number';
    if (typeof r.total === 'number') $('done-total').textContent = money(r.total);
  }

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  // Johannesburg is UTC+2 all year (no daylight saving).
  function icsUtc(iso, hhmm) {
    var p = parts(iso), t = hhmm.split(':').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2], t[0] - 2, t[1]));
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function downloadIcs() {
    var r = state.result;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Motherdough//Fruitcake pre-order//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + r.order_number + '-' + r.pickup_date + '@order.motherdough.co.za',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
      'DTSTART:' + icsUtc(r.pickup_date, r.slot.start),
      'DTEND:' + icsUtc(r.pickup_date, r.slot.end),
      'SUMMARY:' + icsEscape('Collect Motherdough fruitcake (' + r.order_number + ')'),
      'LOCATION:' + icsEscape('Motherdough ' + r.store.name + (r.store.address ? ', ' + r.store.address : '')),
      'DESCRIPTION:' + icsEscape('Order ' + r.order_number + '. Show your order number or confirmation email at the counter.'),
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: 'motherdough-fruitcake-' + r.order_number + '.ics' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------- Steps and history ---------- */

  function cakeReady() { return state.quantity >= 1; }
  function pickupReady() { return cakeReady() && !!findStore(state.store) && !!state.date && !!state.slot && isBookable(availabilityMap()[state.date]); }

  /** Highest step the customer may currently open. */
  function maxStep() {
    if (state.result) return 4;
    if (pickupReady()) return 3;
    if (cakeReady()) return 2;
    return 1;
  }

  function renderStepNav() {
    var ol = $('steps');
    ol.textContent = '';
    var reachable = state.result ? 0 : maxStep();
    STEP_NAMES.forEach(function (name, i) {
      var n = i + 1;
      var text = n + ' ' + name;
      var node;
      if (n === state.step) {
        node = el('span', { className: 'step-item', 'aria-current': 'step', text: text });
      } else if (n < state.step && n <= reachable && n < 4) {
        node = el('button', { type: 'button', className: 'step-item step-link', 'data-goto': String(n), text: text });
      } else {
        node = el('span', { className: 'step-item', text: text });
      }
      ol.appendChild(el('li', null, [node]));
    });
  }

  /** mode: 'push' (normal), 'replace', or 'none' (from popstate). */
  function goToStep(n, mode) {
    if (!state.config) return;
    if (state.result && n < 4) { resetOrder(); n = 1; mode = 'replace'; }
    var wanted = n;
    n = Math.max(1, Math.min(n, state.config.startup ? 1 : maxStep()));
    if (n !== wanted && mode === 'none') mode = 'replace';

    showState(null);
    for (var i = 1; i <= 4; i++) $('step-' + i).hidden = i !== n;
    $('step-nav').hidden = false;
    state.step = n;

    if (n === 2) renderCalendar();
    if (n === 3) { renderSummary(); warmUp(); }
    if (n !== 2) $('date-message').hidden = true;

    renderStepNav();

    var url = window.location.pathname + window.location.search;
    if (mode === 'push') history.pushState({ step: n }, '', url);
    else if (mode === 'replace') history.replaceState({ step: n }, '', url);

    window.scrollTo(0, 0);
    var h = $('h-step-' + n);
    if (h) h.focus({ preventScroll: true });
  }

  function resetOrder() {
    state.result = null;
    state.date = null;
    state.slot = null;
    state.store = null;
    state.quantity = 1;
    state.viewMonth = null;
    $('details-form').reset();
    renderCakeOptions();
    renderPickupStatic();
  }

  /* ---------- Wiring ---------- */

  function bind() {
    $('retry').addEventListener('click', function () { window.location.reload(); });

    $('qty-minus').addEventListener('click', function () {
      if (state.quantity > 1) { state.quantity--; updateQuantity(); }
    });
    $('qty-plus').addEventListener('click', function () {
      if (state.quantity < state.config.max_quantity) { state.quantity++; updateQuantity(); }
    });

    $('to-step-2').addEventListener('click', function () {
      if (state.config.startup) { state.waitingForDates = true; setDatesButton(true); return; }
      goToStep(2, 'push');
    });

    $('cal-prev').addEventListener('click', function () { state.viewMonth = shiftMonth(state.viewMonth, -1); renderCalendar(); });
    $('cal-next').addEventListener('click', function () { state.viewMonth = shiftMonth(state.viewMonth, 1); renderCalendar(); });

    $('to-step-3').addEventListener('click', function () {
      var okDate = !!state.date && isBookable(availabilityMap()[state.date]);
      $('date-error').hidden = okDate;
      var okStore = !!findStore(state.store);
      $('store-error').hidden = okStore;
      $('slot-error').hidden = !!state.slot;
      if (!okStore) { document.querySelector('input[name="store"]').focus(); return; }
      if (!okDate) { var d = document.querySelector('.day.available') || $('cal-next'); d.focus(); return; }
      if (!state.slot) { document.querySelector('input[name="slot"]').focus(); return; }
      goToStep(3, 'push');
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-goto]');
      if (t) { e.preventDefault(); goToStep(Number(t.getAttribute('data-goto')), 'push'); }
    });

    ['f-name', 'f-cell', 'f-email'].forEach(function (id) {
      $(id).addEventListener('focus', warmUp);
      $(id).addEventListener('input', function () {
        $(id).removeAttribute('aria-invalid');
        $('e-' + id.slice(2)).hidden = true;
      });
    });
    $('f-consent').addEventListener('change', function () {
      $('f-consent').removeAttribute('aria-invalid');
      $('e-consent').hidden = true;
    });

    $('details-form').addEventListener('submit', onSubmit);
    $('add-calendar').addEventListener('click', downloadIcs);

    window.addEventListener('popstate', function (e) {
      if (!state.config || state.submitting) return;
      var n = (e.state && e.state.step) || 1;
      goToStep(n, state.result && n < 4 ? 'replace' : 'none');
    });
  }

  bind();
  $('demo-banner').hidden = !DEMO;
  loadConfig();
})();
