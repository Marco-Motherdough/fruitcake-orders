/* Motherdough Christmas fruitcake pre-order page. Vanilla JS, no build step. */
(function () {
  'use strict';

  var CONFIG = {
    // TBD: the Apps Script web app URL (Deploy > Manage deployments > Web app URL).
    API_URL: 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec',
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
    size: null,
    soak: null,
    finish: null,
    extras: [],
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

  function request(method, body) {
    var url = CONFIG.API_URL + (method === 'GET' ? '?action=config&_=' + Date.now() : '');
    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CONFIG.REQUEST_TIMEOUT_MS) : null;
    var opts = { method: method, redirect: 'follow', signal: controller ? controller.signal : undefined };
    if (body) {
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight.
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- Loading config ---------- */

  function loadConfig() {
    showState('loading');
    return request('GET').then(function (cfg) {
      if (!cfg || !cfg.ok) throw new Error((cfg && cfg.error) || 'Bad config');
      state.config = cfg;
      if (!cfg.ordering_open) return showClosed('Orders for Christmas ' + cfg.season_year + ' are closed',
        'Thank you for your support this season.');
      if (cfg.sold_out) return showClosed('We’re fully booked',
        'Every pickup date for Christmas ' + cfg.season_year + ' is full. Thank you for your support.');
      renderCakeOptions();
      renderPickupStatic();
      goToStep(1, 'replace');
    }).catch(function () {
      showState('error');
    });
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
    var o = state.config.options;
    if (!find(o.sizes, state.size)) state.size = o.sizes[0].id;
    if (!find(o.finishes, state.finish)) state.finish = o.finishes[0].id;
    if (state.soak && !find(o.soaks, state.soak)) state.soak = null;
    state.extras = state.extras.filter(function (id) { return find(o.extras, id); });
    state.quantity = Math.min(state.quantity, state.config.max_quantity);

    $('intro-text').textContent = 'Baked to order. Pick up from ' + shortDate(firstDate()) +
      ' to ' + shortDate(state.config.last_pickup_date) + '. Order by ' +
      shortDate(state.config.last_order_date) + '.';

    renderBoxes('size-options', 'size', o.sizes, true);
    renderBoxes('soak-options', 'soak', o.soaks, false);
    renderRows('finish-options', 'finish', 'radio', o.finishes, function (opt) {
      return opt.price ? '+' + money(opt.price) : 'Included';
    });
    $('extras-group').hidden = !o.extras.length;
    renderRows('extra-options', 'extras', 'checkbox', o.extras, function (opt) {
      return '+' + money(opt.price);
    });
    updateQuantity();
  }

  function firstDate() {
    var a = state.config.availability;
    return a.length ? a[0].date : state.config.last_pickup_date;
  }

  function renderBoxes(containerId, key, options, showPrice) {
    var box = $(containerId);
    box.textContent = '';
    options.forEach(function (opt) {
      var input = el('input', { type: 'radio', name: key, value: opt.id });
      input.checked = state[key] === opt.id;
      input.addEventListener('change', function () {
        state[key] = opt.id;
        if (key === 'soak') $('soak-error').hidden = true;
        updateTotals();
      });
      var price = showPrice ? el('span', { className: 'box-price', text: money(opt.price) })
        : (opt.price ? el('span', { className: 'box-price', text: '+' + money(opt.price) }) : null);
      box.appendChild(el('label', { className: 'box' }, [
        input,
        el('span', { className: 'box-body' }, [el('span', { className: 'box-title', text: opt.label }), price])
      ]));
    });
  }

  function renderRows(containerId, key, type, options, priceText) {
    var box = $(containerId);
    box.textContent = '';
    options.forEach(function (opt) {
      var input = el('input', { type: type, name: key, value: opt.id });
      input.checked = type === 'radio' ? state[key] === opt.id : state[key].indexOf(opt.id) !== -1;
      input.addEventListener('change', function () {
        if (type === 'radio') state[key] = opt.id;
        else if (input.checked) state[key].push(opt.id);
        else state[key] = state[key].filter(function (x) { return x !== opt.id; });
        updateTotals();
      });
      box.appendChild(el('label', { className: 'row' }, [
        input,
        el('span', { className: 'row-main' }, [opt.label, opt.note ? el('span', { className: 'row-sub', text: opt.note }) : null]),
        el('span', { className: 'row-price', text: priceText(opt) })
      ]));
    });
  }

  function unitPrice() {
    var o = state.config.options;
    var p = 0;
    var size = find(o.sizes, state.size), soak = find(o.soaks, state.soak), fin = find(o.finishes, state.finish);
    if (size) p += size.price;
    if (soak) p += soak.price;
    if (fin) p += fin.price;
    state.extras.forEach(function (id) { var e = find(o.extras, id); if (e) p += e.price; });
    return p;
  }

  function total() { return unitPrice() * state.quantity; }

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
      ' days to bake and soak your cake. Last pickup is ' + longDate(c.last_pickup_date) + '.';
    $('store-name').textContent = c.store.name;
    $('store-address').textContent = c.store.address;

    var box = $('slot-options');
    box.textContent = '';
    c.slots.forEach(function (slot) {
      var input = el('input', { type: 'radio', name: 'slot', value: slot.id });
      input.checked = state.slot === slot.id;
      input.addEventListener('change', function () { state.slot = slot.id; $('slot-error').hidden = true; });
      box.appendChild(el('label', { className: 'row' }, [
        input,
        el('span', { className: 'row-main', text: slot.label }),
        el('span', { className: 'row-price', text: slot.start.replace(/^0/, '') + '–' + slot.end.replace(/^0/, '') })
      ]));
    });
  }

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
    var o = state.config.options;
    var lines = [
      ['Size', find(o.sizes, state.size).label],
      ['Soak', find(o.soaks, state.soak).label],
      ['Finish', find(o.finishes, state.finish).label]
    ];
    state.extras.forEach(function (id) { lines.push(['Extra', find(o.extras, id).label]); });
    lines.push(['Quantity', String(state.quantity)]);
    fillDl($('summary-cake'), lines);

    var slot = find(state.config.slots, state.slot);
    fillDl($('summary-pickup'), [
      ['Date', shortDate(state.date)],
      ['Time', slot.label + ', ' + slot.start.replace(/^0/, '') + '–' + slot.end.replace(/^0/, '')],
      ['Store', state.config.store.name]
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
      size: state.size,
      soak: state.soak,
      finish: state.finish,
      extras: state.extras.slice(),
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
    $('done-slot').textContent = r.slot.label + ', ' + r.slot.start.replace(/^0/, '') + '–' + r.slot.end.replace(/^0/, '');
    $('done-store').textContent = r.store.name;
    $('done-address').textContent = r.store.address;
    fillDl($('done-summary'), r.summary.map(function (l) { return [l.label, l.value]; }));
    $('done-total').textContent = money(r.total);
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
      'LOCATION:' + icsEscape(r.store.name + ', ' + r.store.address),
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

  function cakeReady() { return !!(state.size && state.soak && state.finish); }
  function pickupReady() { return cakeReady() && !!state.date && !!state.slot && isBookable(availabilityMap()[state.date]); }

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
    n = Math.max(1, Math.min(n, maxStep()));
    if (n !== wanted && mode === 'none') mode = 'replace';

    showState(null);
    for (var i = 1; i <= 4; i++) $('step-' + i).hidden = i !== n;
    $('step-nav').hidden = false;
    state.step = n;

    if (n === 2) renderCalendar();
    if (n === 3) renderSummary();
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
    state.soak = null;
    state.extras = [];
    state.quantity = 1;
    state.viewMonth = null;
    $('details-form').reset();
    renderCakeOptions();
    renderPickupStatic();
  }

  /* ---------- Wiring ---------- */

  function bind() {
    $('retry').addEventListener('click', loadConfig);

    $('qty-minus').addEventListener('click', function () {
      if (state.quantity > 1) { state.quantity--; updateQuantity(); }
    });
    $('qty-plus').addEventListener('click', function () {
      if (state.quantity < state.config.max_quantity) { state.quantity++; updateQuantity(); }
    });

    $('to-step-2').addEventListener('click', function () {
      if (!state.soak) {
        $('soak-error').hidden = false;
        var first = document.querySelector('input[name="soak"]');
        if (first) first.focus();
        return;
      }
      goToStep(2, 'push');
    });

    $('cal-prev').addEventListener('click', function () { state.viewMonth = shiftMonth(state.viewMonth, -1); renderCalendar(); });
    $('cal-next').addEventListener('click', function () { state.viewMonth = shiftMonth(state.viewMonth, 1); renderCalendar(); });

    $('to-step-3').addEventListener('click', function () {
      var okDate = !!state.date && isBookable(availabilityMap()[state.date]);
      $('date-error').hidden = okDate;
      $('slot-error').hidden = !!state.slot;
      if (!okDate) { var d = document.querySelector('.day.available') || $('cal-next'); d.focus(); return; }
      if (!state.slot) { document.querySelector('input[name="slot"]').focus(); return; }
      goToStep(3, 'push');
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-goto]');
      if (t) { e.preventDefault(); goToStep(Number(t.getAttribute('data-goto')), 'push'); }
    });

    ['f-name', 'f-cell', 'f-email'].forEach(function (id) {
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
  loadConfig();
})();
