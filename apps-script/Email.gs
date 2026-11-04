/**
 * Customer confirmation and baker notification emails.
 * HTML templates: email_customer.html, email_baker.html. Plain text is built here.
 */

function emailData_(ctx) {
  var o = ctx.order, s = ctx.settings;
  return {
    order_number: o.order_number,
    first_name: o.name.split(' ')[0],
    name: o.name,
    cell: o.cell,
    email: o.email,
    notes: o.notes,
    pickup_long: longDate_(o.pickup_date),
    pickup_short: shortDate_(o.pickup_date),
    slot_label: o.slot.label,
    slot_time: o.slot.start + '–' + o.slot.end,
    store_name: o.store.name,
    store_address: o.store.address,
    shop_phone: s.shop_phone,
    reply_to: s.reply_to,
    lines: ctx.summary,
    total: o.total === null ? '' : money_(o.total),
    source: o.source
  };
}

function renderTemplate_(file, data) {
  var t = HtmlService.createTemplateFromFile(file);
  t.d = data;
  return t.evaluate().getContent();
}

function sendCustomerEmail_(ctx) {
  var d = emailData_(ctx), s = ctx.settings;
  var contact = s.reply_to || s.shop_phone
    ? 'Questions? Reply to this email' + (s.shop_phone ? ' or call us on ' + s.shop_phone : '') + '.'
    : '';
  var text = [
    'Hi ' + d.first_name + ',',
    '',
    'Thank you for your Motherdough Christmas fruitcake order.',
    '',
    'Order number: ' + d.order_number,
    'Pickup: ' + d.pickup_long + ', ' + d.slot_label + ' ' + d.slot_time,
    'Store: ' + d.store_name + (d.store_address ? ', ' + d.store_address : ''),
    '',
    'Your order:'
  ].concat(d.lines.map(function (l) { return '  ' + l.label + ': ' + l.value; }))
   .concat([
    d.total ? '  Total: ' + d.total : '',
    '',
    'Show this email or your order number at the counter when you collect.',
    contact,
    '',
    'Motherdough'
  ]).join('\n');

  var options = {
    htmlBody: renderTemplate_('email_customer', d),
    name: s.from_name
  };
  if (s.reply_to) options.replyTo = s.reply_to;
  GmailApp.sendEmail(d.email, 'Your Motherdough fruitcake order ' + d.order_number, text, options);
}

function sendBakerEmail_(ctx) {
  var d = emailData_(ctx), s = ctx.settings;
  var text = [
    'New fruitcake order ' + d.order_number,
    '',
    'Pickup: ' + d.pickup_long + ', ' + d.slot_label + ' ' + d.slot_time,
    'Store: ' + d.store_name,
    '',
    'Customer: ' + d.name,
    'Cell: ' + d.cell,
    'Email: ' + d.email,
    ''
  ].concat(d.lines.map(function (l) { return l.label + ': ' + l.value; }))
   .concat([
    d.total ? 'Total: ' + d.total : '',
    d.source ? 'Source: ' + d.source : ''
  ]).join('\n');

  GmailApp.sendEmail(s.baker_emails.join(','),
    'New fruitcake order ' + d.order_number + ', ' + d.store_name + ' pickup ' + d.pickup_short, text, {
      htmlBody: renderTemplate_('email_baker', d),
      name: s.from_name,
      replyTo: d.email
    });
}
