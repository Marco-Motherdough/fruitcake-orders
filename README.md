# Motherdough Christmas fruitcake pre-order

Customers scan a QR code in store, build their fruitcake, pick a pickup date (at least 14 days out) and leave their details. Orders go into a Google Sheet, and emails go to the customer and the baker. There are no payments in v1.

`CLAUDE.md` is the full spec. This file covers setup and deploy.

```
web/          The order page (GitHub Pages). index.html, styles.css, app.js, CNAME
apps-script/  The API (Google Apps Script). .gs files, email templates, appsscript.json
design/       Exported screenshots of the approved design
```

## Still waiting on the business (TBD)

Fill these in before launch. Most go in the **Settings** tab of the sheet, so they need no code change.

| What | Where |
|---|---|
| Daily capacity (cakes per pickup date) | Settings `daily_capacity` (**required**) |
| Store name and address | Settings `store_name`, `store_address` (**required**) |
| Baker email addresses | Settings `baker_emails` (**required**) |
| Real prices and options | Settings `options_json` (placeholders are in there now) |
| Is the gift box charged per cake or per order? | The code charges per cake; tell the developer if it should be per order |
| Last order date, last pickup date | Settings (placeholders 2026-12-10, 2026-12-24) |
| Closed dates and weekdays | Settings `closed_dates`, `closed_weekdays` |
| Collection slots | Settings `slots` (placeholders 7:30–11:00, 11:00–13:30, 13:30–16:00) |
| Shop phone number | Settings `shop_phone` **and** `SHOP_PHONE` in `web/app.js` (used when the API can't be reached) |
| Reply-to and alert email | Settings `reply_to`, `alert_email` |
| Owner Google account | e.g. `orders@motherdough.co.za`, which must be Google Workspace |
| Subdomain and who manages DNS | `web/CNAME` is set to `order.motherdough.co.za` |
| Logo file and fruitcake photo | `web/assets/`. Swap the placeholders marked `TBD` in `web/index.html` |
| Data retention period after the season | POPIA, see CLAUDE.md |

## 1. Create the sheet and script

Sign in as the **shared business account**, not a personal one.

1. Create a new Google Sheet called "Fruitcake orders 2026".
2. Open **Extensions > Apps Script**. This creates a script bound to the sheet.
3. Note the script ID (**Project Settings > IDs**).

## 2. Push the code with clasp

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

```bash
cd apps-script && cp .clasp.json.example .clasp.json
```

Put the script ID in `.clasp.json`, then:

```bash
clasp push
```

`.clasp.json` holds only the script ID and is fine to commit. Never commit `~/.clasprc.json`, which holds your login token.

## 3. Run setup

In the Apps Script editor, select the `setup` function and click **Run**. Approve the permissions (Sheets and Gmail). This creates the `Orders`, `Settings`, `Capacity` and `Log` tabs and fills Settings with placeholders. It is safe to run again, because it never overwrites filled-in values.

Fill in the Settings values from the TBD table above, then run `checkSettings` (it lists anything missing) and `previewConfig` (it shows exactly what the page will receive).

Settings notes:
- Dates are written as `yyyy-mm-dd` text.
- `closed_weekdays` takes values like `Sun, Mon`.
- To change capacity for one date, add a row to the **Capacity** tab (`date | max`). Use `0` to close that date.
- Set an order's `status` to `cancelled` to free its cakes back into that date's capacity.

Share the sheet only with the people who need it.

## 4. Deploy the web app

1. **Deploy > New deployment > Web app**.
2. Set Execute as to **Me** and Who has access to **Anyone**.
3. Copy the web app URL (ends in `/exec`) into `API_URL` at the top of `web/app.js`.

**Updating the script later:** after `clasp push`, go to **Deploy > Manage deployments**, edit the existing deployment, and choose **Version: New version**. This keeps the same URL. Do not create a new deployment, or the URL changes. Code changes are not live until you do this.

Quick check: open `<web app URL>?action=config` in a browser. You should see JSON with `"ok":true`.

## 5. Publish the page

1. Repo **Settings > Pages > Source: GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `web/` on every push to `main` that touches it.
2. Custom domain: `order.motherdough.co.za` (already in `web/CNAME`). Tick **Enforce HTTPS** once the certificate is issued.
3. At the DNS host, add `CNAME order → <github-user-or-org>.github.io`.

## 6. Test, then print QR codes

Work through the "Testing before launch" checklist in `CLAUDE.md`. To fill a date quickly, set its row in the **Capacity** tab to a small number.

Only after the live page is tested, generate QR codes for `https://order.motherdough.co.za/?src=counter`. Use a different `src` for each placement (`src=window`, `src=till`, and so on). The value lands in the `source` column.

## How it works

- **Page** (`web/`): static HTML, CSS and vanilla JS. On load it fetches `GET ?action=config` for options, prices, slots, store and per-date availability, so no prices are hard-coded. The four steps are sections in one page and use `history.pushState`, so the phone's back button works. Orders are POSTed as JSON with `Content-Type: text/plain`, which avoids a CORS preflight that Apps Script can't answer. No customer data goes into URLs, localStorage or analytics.
- **API** (`apps-script/`):
  - `Code.gs`: entry points `doGet` and `doPost`.
  - `Orders.gs`: validation, the lock and the append.
  - `Availability.gs`: capacity per date, counted in cakes.
  - `Settings.gs`: settings parsing and date helpers.
  - `Email.gs` plus the `email_*.html` templates: the customer and baker emails.
  - `Log.gs`: the Log tab and throttled alert emails.
  - `Setup.gs`: one-time setup.

  The total is always worked out by the script from Settings prices. Capacity is re-checked inside `LockService` before the row is appended, so two people can't both get the last slot. If an email fails, the order is still saved: the `email_*_sent` column shows `FAILED` and an alert is sent.
