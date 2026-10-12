# Setup guide

Do these once, in order. Everything is on free tiers. Use Stripe **test mode** until the end.

Values you'll collect:

| Value | Where it goes |
| --- | --- |
| Supabase project URL | Cloudflare build variable `PUBLIC_SUPABASE_URL` **and** Worker secret `SUPABASE_URL` |
| Supabase anon / publishable key | Cloudflare build variable `PUBLIC_SUPABASE_ANON_KEY` |
| Supabase service_role / secret key | Worker secret `SUPABASE_SERVICE_ROLE_KEY` |
| Stripe secret key | Worker secret `STRIPE_SECRET_KEY` |
| Stripe webhook signing secret | Worker secret `STRIPE_WEBHOOK_SECRET` |
| Cloudflare account ID | Worker secret `R2_ACCOUNT_ID` |
| R2 access key ID + secret | Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| *(optional)* Slack/Discord/ntfy webhook URL | Worker secret `QUOTE_NOTIFY_URL` |
| *(optional)* Turnstile site key + secret | Build variable `PUBLIC_TURNSTILE_SITE_KEY`, Worker secret `TURNSTILE_SECRET_KEY` |

---

## 1. Supabase (sign-in + database)

1. Create a project at supabase.com.
2. **SQL Editor** → paste `supabase/migrations/20261012000000_init.sql` → Run.
3. **Authentication → URL Configuration**
   - Site URL: your production URL
   - Redirect URLs: `https://YOUR-DOMAIN/**` and `http://localhost:8787/**`
4. **Authentication → Providers → Email**: keep "Confirm email" on. Agency access is granted by email address, so it must be verified.
5. **Project Settings → API**: copy the project URL, the anon (*publishable*) key and the service_role (*secret*) key.
   The service key bypasses all security. It only goes into Cloudflare secrets and your local `.dev.vars`, never the repo.
6. Before launch: **Authentication → Emails → SMTP** with a real sender. Supabase's built-in email is rate-limited and meant for testing.

Quote requests land in the `quote_requests` table (Table Editor). Update `status` as you work them.

## 2. Stripe (billing)

You bill agencies from the Stripe dashboard. The site never takes card payments itself.

### Products and prices

Create three products: **Agency Standard**, **Small Agency Bundle**, **Records Pro**. Give each the prices you sell,
and set each price's **Lookup key** (Price → More options → Lookup key). The lookup key is how the webhook knows what was bought:

| Lookup key | Price type | Example | Creates |
| --- | --- | --- | --- |
| `standard_annual` | Recurring yearly, per unit | $129 | annual license, seats = quantity |
| `pro_annual` | Recurring yearly, per unit | $199 | annual license, seats = quantity |
| `bundle_annual` | Recurring yearly, flat | $990 | annual license, 10 seats per unit |
| `standard_perpetual` | One-off, per unit | $258 | perpetual license + 1 year of updates |
| `pro_perpetual` | One-off, per unit | $398 | perpetual license + 1 year of updates |
| `bundle_perpetual` | One-off, flat | $1,980 | perpetual license (10 seats) + 1 year of updates |
| `standard_maintenance` | One-off, per unit | 20% | +1 year of updates on that plan's perpetual license |
| `pro_maintenance` / `bundle_maintenance` | One-off | 20% | same, for those plans |

Prices without one of these lookup keys are ignored by the webhook, so you can still invoice other things (training, onboarding).

### Selling to an agency

1. A quote request arrives (Supabase table, plus a ping if `QUOTE_NOTIFY_URL` is set).
2. Create the **customer** in Stripe with the agency's name and the records contact's email, or run
   `npm run agency:add` (below), which creates the Stripe customer for you.
   Optional customer metadata: `ori` = the agency ORI.
3. Bill them one of two ways:
   - **Auto-renewing:** Subscriptions → Create → `*_annual` price, quantity = seats → Payment: *Email invoice*, due in 30 days.
     Stripe re-invoices every year; the license follows the subscription (active, past due, cancelled).
   - **One invoice per year:** Invoices → Create → add the `*_annual` price → *Email invoice*, Net 30.
     When it's paid the agency gets a license good for a year; each later paid `*_annual` invoice adds another year.
     Many agencies prefer this because nothing renews without a new PO.
   - **Perpetual:** Invoice the `*_perpetual` price; later, invoice `*_maintenance` each year to keep updates current.
4. **Founding Agency Offer:** Products → Coupons → 40% off, duration *Once*. Apply it to the subscription or invoice.
5. The agency's contact signs up on the site with the email on the Stripe customer and sees their license key.

Annual subscriptions get a license as soon as they're created (Net 30 terms). Term and perpetual licenses are issued when the invoice is **paid**.

### Settings

- **Settings → Billing → Customer portal**: turn on invoice history and payment-method updates. Turn *off* cancellation and plan switching if you'd rather handle those by email.
- **Settings → Billing → Invoices**: set Net 30 as the default, add your business details and logo.
- **Developers → Webhooks → Add endpoint**
  - URL: `https://YOUR-DOMAIN/api/stripe/webhook`
  - Events: `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
  - Copy the signing secret (`whsec_…`).
- **Developers → API keys**: copy the secret key (`sk_test_…`).

### Refunds and revoking

Refunding in Stripe doesn't remove a license on its own, so you decide. To revoke one, run this in the Supabase SQL editor:
`update licenses set status = 'revoked' where license_key = 'BL-XXXX-XXXX-XXXX-XXXX';`
Cancelling a subscription in Stripe ends that license automatically.

## 3. Pilots (no Stripe involved)

```bash
npm run agency:add -- --name "Fulton Police Department" --ori MO0140100 \
  --email records@fulton.gov --email it@fulton.gov \
  --pilot-days 90 --plan standard --seats 5
```

This adds the agency and its contacts, creates the matching Stripe customer (tagged with the agency id, so a later invoice
attaches to the same agency), and prints a pilot license key that stops working after 90 days. Add `--no-stripe` to skip Stripe.
It reads keys from `.dev.vars`.

## 4. Cloudflare R2 (installers and documents)

1. Cloudflare dashboard → **R2** → Create bucket `blueline-installers`. Leave public access **off**.
2. **R2 → Manage API tokens → Create API token**: *Object Read only*, scoped to `blueline-installers`.
   Copy the Access Key ID and Secret. Your account ID is shown on the R2 overview page.
3. Upload the two documents the Resources section offers (exact names matter):
   ```bash
   npx wrangler r2 object put blueline-installers/resources/Blueline-Security-CJIS-Summary.pdf --file ./Blueline-Security-CJIS-Summary.pdf --remote
   npx wrangler r2 object put blueline-installers/resources/Blueline-Vendor-Packet.zip --file ./Blueline-Vendor-Packet.zip --remote
   ```
   The security summary is public. The vendor packet is only handed to signed-in visitors because it contains your W-9.

## 5. Cloudflare Worker (the site)

1. **Workers & Pages → Create → Import a repository** → `pacem35/bluelinepdfsite`.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
2. **Settings → Build → Variables**: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (and `PUBLIC_TURNSTILE_SITE_KEY` if used).
3. **Settings → Variables and Secrets**, as *Secret*: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (plus the optional ones).
4. In `wrangler.jsonc`, set `SITE_URL` to your production URL. Commit and push; the site redeploys.
5. **Settings → Domains & Routes → Add custom domain** once you have one.

Check: `https://YOUR-DOMAIN/api/health` returns `{"ok":true}`.

**Spam protection (recommended):** Cloudflare dashboard → Turnstile → Add widget for your domain. Put the site key in the build
variable and the secret in the Worker secret. The form already has a hidden honeypot field; Turnstile stops the rest.

## 6. Publish an installer

```bash
npm run release:prepare -- ./BluelinePDF-Setup-1.0.0.exe windows 1.0.0
```

It prints the upload command and an SQL `insert` to run in Supabase. Every "Free download" button then serves that build.
Until a release is published, those buttons show a "coming soon" page that points to the pilot form.

Wrangler uploads cap out at a few hundred MB. For bigger installers use any S3 tool against
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with an R2 token that has write access.

To pull a build: `update releases set published = false where platform = 'windows' and version = '1.0.0';`

## 7. Test the whole flow (test mode)

1. Home page → Free download → the installer downloads (link dies after 5 minutes).
2. Submit the quote form → a row appears in `quote_requests`.
3. `npm run agency:add -- --name "Test PD" --email you@example.com --pilot-days 90`
4. Sign up on the site as `you@example.com`, confirm the email → Account shows the pilot license and key.
5. In Stripe, invoice that customer for `standard_annual`, then mark it paid → the account shows an annual license.
6. Webhooks page in Stripe shows 200 responses.

## 8. Go-live checklist

- [ ] Stripe live mode: recreate products/prices with the same lookup keys, add a live webhook, swap `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- [ ] Prices and copy in `src/config/site.ts` match what you'll invoice
- [ ] Terms and Privacy pages written (`src/pages/terms.astro`, `src/pages/privacy.astro`)
- [ ] Contact email in `src/config/site.ts`
- [ ] Supabase custom SMTP
- [ ] Security summary and vendor packet uploaded to R2
- [ ] Your W-9 shows an EIN rather than your SSN before it goes in the vendor packet
- [ ] Turnstile on the quote form
- [ ] Windows installer code-signed so SmartScreen doesn't warn agencies on first run
