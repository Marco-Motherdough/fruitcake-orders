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
    contact_email: s.contact_email,
    contact: contactLine_(s),
    reply_to: s.reply_to,
    no_reply: s.no_reply,
    lines: ctx.summary,
    total: o.total === null ? '' : money_(o.total),
    source: o.source
  };
}

/** The contact sentence at the bottom of the customer email. */
function contactLine_(s) {
  var ways = [];
  if (s.contact_email) ways.push('email us at ' + s.contact_email);
  if (s.shop_phone) ways.push('call us on ' + s.shop_phone);
  var ask = ways.length ? 'Questions? ' + ways.join(' or ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.' : '';
  if (s.no_reply) return ('This is an automated email, please don\'t reply. ' + ask).trim();
  if (s.reply_to) return 'Questions? Reply to this email' + (ways.length ? ' or ' + ways.join(' or ') : '') + '.';
  return ask;
}

function renderTemplate_(file, data) {
  var t = HtmlService.createTemplateFromFile(file);
  t.d = data;
  return t.evaluate().getContent();
}

function sendCustomerEmail_(ctx) {
  var d = emailData_(ctx), s = ctx.settings;
  var contact = d.contact;
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
  if (s.no_reply) options.noReply = true; // Google Workspace only: sends from a no-reply address
  else if (s.reply_to) options.replyTo = s.reply_to;
  MailApp.sendEmail(d.email, 'Your Motherdough fruitcake order ' + d.order_number, text, options);
}

function sendBakerEmail_(ctx) {
  var d = emailData_(ctx), s = ctx.settings;
  if (!s.baker_emails.length) throw new Error('SKIP');
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

  var to = s.baker_emails.join(',');
  var subject = 'New fruitcake order ' + d.order_number + ', ' + d.store_name + ' pickup ' + d.pickup_short;
  try {
    MailApp.sendEmail(to, subject, text, {
      htmlBody: renderTemplate_('email_baker', d),
      name: s.from_name,
      replyTo: d.email
    });
  } catch (err) {
    // Google sometimes refuses the full version (seen when sender, recipient and
    // reply-to overlap). Retry once as plain text with no reply-to, so the
    // bakery always gets the order.
    Utilities.sleep(1500);
    MailApp.sendEmail(to, subject, text + '\n\n(Reply to the customer at ' + d.email + ')', { name: s.from_name });
  }
}
