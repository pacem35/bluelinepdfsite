# Setup guide

Do these once, in order. Everything here is on free tiers. Use Stripe **test mode** until the end.

You'll collect these values along the way:

| Value | Where it goes |
| --- | --- |
| Supabase project URL | Cloudflare build variable `PUBLIC_SUPABASE_URL` **and** Worker secret `SUPABASE_URL` |
| Supabase anon / publishable key | Cloudflare build variable `PUBLIC_SUPABASE_ANON_KEY` |
| Supabase service_role / secret key | Worker secret `SUPABASE_SERVICE_ROLE_KEY` |
| Stripe secret key | Worker secret `STRIPE_SECRET_KEY` |
| Stripe webhook signing secret | Worker secret `STRIPE_WEBHOOK_SECRET` |
| Stripe Price IDs (3) | `wrangler.jsonc` → `vars` |
| Cloudflare account ID | Worker secret `R2_ACCOUNT_ID` |
| R2 access key ID + secret | Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |

---

## 1. Supabase (auth + database)

1. Create a project at supabase.com.
2. **SQL Editor** → paste `supabase/migrations/20261012000000_init.sql` → Run.
   (Or with the CLI: `supabase link` then `supabase db push`.)
3. **Authentication → URL Configuration**
   - Site URL: your production URL, e.g. `https://bluelinepdf.com`
   - Redirect URLs: `https://bluelinepdf.com/**` and `http://localhost:8787/**`
4. **Authentication → Providers → Email**: leave email confirmation on.
5. **Project Settings → API**: copy the project URL, the anon (or *publishable*) key, and the service_role (or *secret*) key.
   The service key bypasses all security rules. It only ever goes into Cloudflare secrets, never the browser or the repo.
6. Before launch, set up **custom SMTP** (Authentication → Emails). Supabase's built-in sender is rate-limited and meant for testing.

## 2. Stripe (billing)

1. **Product catalog → Add product** "Blueline PDF" with three prices:
   - Monthly: recurring, monthly
   - Yearly: recurring, yearly
   - Lifetime: one-off
   Copy each Price ID (`price_…`) into `wrangler.jsonc` → `vars`. Leave `STRIPE_PRICE_LIFETIME` empty to hide that option server-side (also remove it from `src/config/site.ts`).
2. Make the displayed prices in `src/config/site.ts` match.
3. **Settings → Billing → Customer portal**: turn on cancel, update payment method, invoice history, and switching between the Monthly and Yearly prices.
4. **Developers → Webhooks → Add endpoint**
   - URL: `https://YOUR-DOMAIN/api/stripe/webhook`
   - Events:
     `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
     `customer.subscription.paused`, `customer.subscription.resumed`,
     `charge.refunded`, `charge.dispute.created`
   - Copy the signing secret (`whsec_…`).
5. **Developers → API keys**: copy the secret key (`sk_test_…`).

## 3. Cloudflare R2 (installer storage)

1. Cloudflare dashboard → **R2** → Create bucket `blueline-installers`. Leave public access **off**.
   (To use another name, change `R2_BUCKET` in `wrangler.jsonc`.)
2. **R2 → Manage API tokens → Create API token**
   - Permission: **Object Read only**
   - Bucket: `blueline-installers` only
   Copy the Access Key ID and Secret Access Key. Your account ID is in the sidebar of the R2 page.

## 4. Cloudflare Worker (the site)

1. **Workers & Pages → Create → Import a repository** → choose `pacem35/bluelinepdfsite`.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
2. **Settings → Build → Variables**: add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
3. **Settings → Variables and Secrets**: add as *Secret*: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   (CLI alternative: `npx wrangler secret put NAME`.)
4. In `wrangler.jsonc`, set `SITE_URL` to your production URL and fill in the Price IDs. Commit and push: the site redeploys itself.
   Non-secret settings live in `wrangler.jsonc` on purpose; a deploy overwrites plain variables set in the dashboard.
5. **Settings → Domains & Routes → Add custom domain** once you have one.

Check it: `https://YOUR-DOMAIN/api/health` should return `{"ok":true}`.

## 5. Publish an installer

```bash
npm run release:prepare -- ./BluelinePDF-Setup-1.0.0.exe windows 1.0.0
```

It prints two things: a `wrangler r2 object put …` command to upload the file, and an SQL `insert` to run in Supabase.
Platform names `windows`, `macos` and `linux` get friendly labels (edit `platformLabels` in `src/config/site.ts` for others).

Wrangler uploads cap out at a few hundred MB. For bigger installers use any S3 tool against
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with an R2 token that has write access.

To pull a build: `update public.releases set published = false where platform = 'windows' and version = '1.0.0';`
The previous published version becomes the download again.

## 6. Test the whole flow (test mode)

1. Create an account on the site and confirm the email.
2. Pricing → Choose yearly → pay with card `4242 4242 4242 4242`, any future date, any CVC.
3. You land on Your account; within a few seconds the license shows Active and Download is enabled.
4. Download → the browser gets the file from a URL that stops working after 5 minutes.
5. Manage billing → cancel → the account shows "Access ends" with the date.
6. Stripe dashboard → Webhooks → your endpoint shows 200 responses.

## 7. Go-live checklist

- [ ] Stripe: switch to live mode, create the products/prices again in live, add a live webhook endpoint, replace `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the Price IDs
- [ ] Real prices in `src/config/site.ts` and feature list confirmed
- [ ] Terms and Privacy pages written (`src/pages/terms.astro`, `src/pages/privacy.astro`); Stripe requires them
- [ ] Support email in `src/config/site.ts`
- [ ] Supabase custom SMTP configured
- [ ] Decide on sales tax/VAT: enable Stripe Tax and flip `automatic_tax` in `worker/routes/checkout.ts`
- [ ] `SITE_URL` and Supabase redirect URLs point at the real domain
- [ ] Sign your Windows/macOS installers so the OS doesn't warn users on first run
