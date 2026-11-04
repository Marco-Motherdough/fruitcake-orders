# Motherdough Christmas fruitcake pre-order app

Customers scan a QR code in store, build their fruitcake on their phone, pick a pickup date at least 14 days out, and leave their details. The order is saved to a Google Sheet, and emails go to the customer (confirmation) and the baker (new order). Payments are **out of scope for v1** (see "Later").

Items marked **TBD** are still waiting on the business. Do not invent values for them; keep them in the Settings sheet or as clearly marked placeholders.

---

## Stack

| Part | Where | Notes |
|---|---|---|
| Order page (4 screens) | GitHub Pages, custom domain `order.motherdough.co.za` (**TBD**: confirm subdomain) | Static HTML/CSS/vanilla JS, no framework, no build step |
| Logic / API | Google Apps Script web app | Executes as the owner account, access "Anyone" |
| Data | Google Sheet (tabs: `Orders`, `Settings`, `Log`) | Owned by the shared business account |
| Email | Gmail via Apps Script (`GmailApp`) | Sent from the owner account or an alias |
| Code | This GitHub repo | Apps Script synced with `clasp` |

Same pattern as Motherdough's existing apps (GitHub page + Apps Script + Sheets). If a reference repo is provided, follow its conventions. **TBD**: name of reference repo.

Owner account for the Sheet and script: a shared business Google account, NOT a personal one (e.g. `orders@motherdough.co.za`, **TBD**).

## Repo layout

```
/web                  GitHub Pages site (index.html, styles.css, app.js, assets/)
/apps-script          Code.gs (and split .gs files), appsscript.json, email templates (.html)
/design               Exported screenshots of the approved design
CLAUDE.md
README.md             Setup and deploy steps for humans
```

`.clasp.json` holds the script ID only. Never commit credentials, `.clasprc.json`, or tokens.

---

## Customer flow (one page, four steps)

Single `index.html`; steps are sections shown one at a time with JS (no page reloads). Browser back button should move between steps (use `history.pushState`).

1. **Cake**: size, soak, finish, extras (gift box), quantity, running total. Button: CHOOSE PICKUP DATE.
2. **Pickup**: month calendar plus collection time slot. Button: CONTINUE.
3. **Details**: full name, cell, email, optional gift tag / allergy note, order summary with "Change" link back to step 1, POPIA consent checkbox (required). Button: PLACE ORDER.
4. **Done**: order number, pickup date and time, store, order summary, total, "Add to calendar" (.ics download), link back to motherdough.co.za.

Top of every step: logo, the line "CHRISTMAS FRUITCAKE · PRE-ORDER", step indicator text "1 CAKE · 2 PICKUP · 3 DETAILS · 4 DONE" (current step bold with caramel underline; completed steps are links).

The page fetches options, prices and availability from the API on load, so prices are never hard-coded in the page.

## Design (approved, match it)

Design canvas (private to Motherdough): https://claude.ai/artifact/Xc7GKrPfGJpc8uMz77U5J9. Exported images go in `/design`.

Look: matches motherdough.co.za, editorial and calm, NOT an app template. No rounded pills, no cards with shadows, no progress bars, no emoji, no gradient.

| Token | Value | Use |
|---|---|---|
| Background | `#FFFFFF` | Page |
| Text | `#4C3329` | Body text, primary buttons (white text on it) |
| Caramel | `#AE8344` | Large headings (28px), logo wordmark, active step underline, "few left" dot |
| Caramel dark | `#8A6331` | Small spaced-caps labels (11px, letter-spacing 2px) |
| Muted text | `#7A655A` | Secondary text |
| Rule | `#EFE7DC` | 1px dividers between list rows and sections |
| Control border | `#9E8A78` | Inputs and option boxes |
| Disabled | `#A8978B` | Full or unavailable dates |

- Font: Poppins 400/500/600 (Google Fonts). Body letter-spacing ~0.3px.
- Logo: use the real logo file when supplied (**TBD**). Until then, "MOTHERDOUGH" in Josefin Sans 600, caramel, with "1919" beneath.
- Buttons: square (radius 2px), min height 50px, uppercase, letter-spacing 2px, 12px. Primary = brown fill, white text. Secondary = 1px brown outline.
- Size and soak = grid of square bordered boxes; selected = 2px brown border plus bold. Finish, extras and time slots = list rows with native radio/checkbox, thin rule between rows.
- Full-width fruitcake photo at top of step 1 (**TBD**: photo).
- Mobile first, designed at 390px wide; must also look fine on desktop (center a max-width ~480px column).
- Accessibility: real `<button>`, `<label>` + `<input>`, 44px minimum touch targets, text contrast at least 4.5:1, `aria-current="step"` on the current step, visible focus states.

---

## Business rules

All values live in the `Settings` sheet so staff can change them without code. Values shown are the design placeholders.

- **Lead time:** earliest pickup = today + 14 days (Africa/Johannesburg time). Setting `lead_days` = 14.
- **Order cut-off:** last order date 10 December (`last_order_date`, **TBD** confirm). After it, the page shows "Orders for Christmas 2026 are closed" and the API rejects orders.
- **Last pickup date:** 24 December (`last_pickup_date`, **TBD** confirm).
- **Daily capacity:** max cakes per pickup date (`daily_capacity`, **TBD**). Count by quantity, not by order. Optional per-date overrides in a `Capacity` tab (date, max).
- **Closed days:** list of dates and/or weekdays (`closed_dates`, `closed_weekdays`, **TBD**).
- **"Few left":** show the dot when remaining for that date is at or below `few_left_threshold` (default 3).
- **Collection slots** (**TBD**: confirm): Morning 7:30–11:00, Midday 11:00–13:30, Afternoon 13:30–16:00.
- **Store:** name and address (**TBD**). If more than one store, add a store choice on step 2.
- **Options and prices** (**TBD**: real values; placeholders below):
  - Size: 500 g R220, 1 kg R380, 2 kg R680
  - Soak: Brandy, Alcohol-free (no price difference)
  - Finish: Plain apricot glaze (included), Marzipan +R60, Marzipan and royal icing +R95
  - Extras: Gift box with ribbon +R45
  - Quantity: 1 to `max_quantity` (default 5)
- **Total is always calculated by the script**, never trusted from the page.

---

## Google Sheet structure

### `Orders` tab (one row per order, append only)
`order_number | created_at | status | pickup_date | pickup_slot | store | name | cell | email | size | soak | finish | gift_box | quantity | notes | total | consent | source | email_customer_sent | email_baker_sent`

- `order_number`: `MD-` + zero-padded counter (MD-0001). Counter stored in Settings, incremented inside the lock.
- `status`: `confirmed` (v1). Later: `pending_payment`, `paid`, `baked`, `collected`, `cancelled`. Staff may edit this column.
- `source`: from the QR URL parameter (e.g. `?src=counter`), for tracking which QR code works.
- Freeze the header row; format date and money columns.

### `Settings` tab (key | value)
`lead_days, last_order_date, last_pickup_date, daily_capacity, few_left_threshold, max_quantity, closed_dates, closed_weekdays, slots, store_name, store_address, baker_emails, alert_email, from_name, reply_to, order_counter, options_json`

`options_json` holds sizes, soaks, finishes and extras with prices, so the page and the script share one source of truth.

### `Log` tab
Timestamp, level, message. Rejected orders and errors go here.

---

## Apps Script API

One web app deployment, two actions. Keep responses JSON.

- `GET ?action=config` returns options, prices, slots, store, cut-off state, and per-date availability for the bookable window: `{date, remaining, status: open|few|full|closed}`.
- `POST` (order) with body as JSON string. **Send with `Content-Type: text/plain`** to avoid a CORS preflight, which Apps Script web apps do not handle. Parse `e.postData.contents` on the server.

Order handling, in order:
1. Reject if the honeypot field is filled, or if more than N requests in a short time per email (simple rate limit via `CacheService`).
2. Validate every field: required fields present, email format, SA cell format, options exist in Settings, quantity in range, consent true, pickup date within the window and not closed, slot valid.
3. Take `LockService.getScriptLock()` (wait up to ~10s). Re-check capacity for that date **inside the lock**, increment the order counter, append the row, release the lock. This prevents double-booking the last slot.
4. Calculate the total from Settings prices.
5. Send emails (outside the lock). Record send success in the row. Email failure must not lose the order.
6. Return `{ok: true, order_number, pickup_date, slot, total, summary}` or `{ok: false, error: "<friendly message>"}`. If capacity filled while the customer was choosing, return a clear message and fresh availability so the page can ask them to pick another date.

Errors: wrap handlers in try/catch, write to `Log`, and email `alert_email` on unexpected errors (throttle to avoid floods). Never return stack traces to the page.

Deploy as a versioned deployment ("Execute as: Me", "Who has access: Anyone"). Updating code does not change the live version until a new version is deployed; keep the deployment ID stable so the page URL doesn't change.

## Emails

HTML templates in `/apps-script` with a plain-text fallback, same colours and tone as the page.

- **Customer:** subject "Your Motherdough fruitcake order MD-0412". Includes the order number, pickup date and slot, store address, full order, total, "show this email or your order number at the counter", and a contact line. Reply-to = `reply_to` setting.
- **Baker:** subject "New fruitcake order MD-0412, pickup Sat 19 Dec". Full order, customer name and cell, notes, total. Recipients = `baker_emails` (**TBD**). Includes the full order so the inbox doubles as a backup.
- **Later (optional):** reminder email the day before pickup via a daily time-driven trigger.

Gmail limits: about 1,500 recipients a day on Google Workspace, about 100 on free Gmail. Use a Workspace account.

---

## Page behaviour details

- Show a loading state while fetching config. If the API fails, show a friendly message with the shop phone number (**TBD**).
- Disable the PLACE ORDER button and show "Placing your order…" while submitting. Apps Script can take 1–3 seconds.
- Keep the selections in memory while moving between steps; if a chosen date becomes full on submit, return to step 2 with a message.
- Hidden honeypot input on step 3.
- Read `?src=` from the URL and send it with the order.
- No customer data in URLs, localStorage or analytics.
- "Add to calendar" generates an .ics file client-side.

## Safety and privacy (POPIA)

- No credentials or private IDs in the page beyond the public web app URL.
- Sheet shared only with the people who need it.
- Consent checkbox required; data used only for this order. Plan to archive or delete customer rows after the season (**TBD**: retention period).
- Payments, when added, happen on the provider's hosted page; no card data ever touches this app.

## Testing before launch

- [ ] Order end to end with a test email; row appears; both emails arrive and render on mobile
- [ ] Capacity: fill a date, confirm it shows full and the API rejects extra orders
- [ ] Two simultaneous orders for the last slot: only one succeeds
- [ ] Dates before the lead time, closed days, after the last pickup date are not selectable
- [ ] After the cut-off date, ordering is closed on the page and in the API
- [ ] Invalid inputs and honeypot rejected; friendly messages shown
- [ ] Changing a price in Settings changes the page and the email totals
- [ ] Works on iPhone Safari and Android Chrome; QR code scans from print
- [ ] Error alert email arrives when the script fails

## Deploy

1. Create the Sheet (owner account) with the tabs above and fill Settings.
2. Create the bound Apps Script project; `clasp clone`/`clasp push` from `/apps-script`; deploy the web app; put the web app URL in `/web/app.js` config.
3. Enable GitHub Pages from `/web` (GitHub Actions or branch folder); add `CNAME` for `order.motherdough.co.za`; add the DNS CNAME record at the domain host (**TBD**: who manages DNS).
4. Generate the QR code for `https://order.motherdough.co.za/?src=counter` (and other `src` values per placement) only after the page is live and tested.

## Later (not v1)

- **Payments:** Yoco Checkout API (Motherdough already uses Yoco in store) or Shopify checkout. Would add `pending_payment` status, a checkout redirect, and a verified payment webhook before emails send. Note: Apps Script cannot read webhook signature headers, so payment confirmation may need a small serverless function or to be handled through Shopify. Decide before building.
- Day-before reminder emails.
- Staff view or filters for the daily bake list.
