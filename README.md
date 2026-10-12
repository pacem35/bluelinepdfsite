# Blueline — website

Marketing site, free Officer Edition download, agency quote requests, licenses and billing for
Blueline, the offline-first PDF and records tool for police agencies.

| Concern | Choice | Why |
| --- | --- | --- |
| Hosting | **Cloudflare Workers** (static site + API in one Worker), deployed from this repo on every push | Free tier allows commercial use (Vercel's free Hobby plan doesn't). Static pages are served free and without limit; only `/api/*` calls count toward the 100k requests/day free allowance. Cloudflare recommends Workers over Pages for new projects, with the same Git-connected deploys. |
| Auth + database | **Supabase** | Sign-in for agency contacts (password or emailed link) plus Postgres for agencies, licenses and quote requests. |
| Billing | **Stripe** invoices (Net 30) and subscriptions, run from the Stripe dashboard; a webhook at `/api/stripe/webhook` turns paid invoices into licenses | Agencies buy on quotes and invoices, not card checkouts. Stripe's hosted invoice page accepts card or ACH. |
| Installers | **Cloudflare R2**, private bucket, presigned URLs that expire after 5 minutes | Free Officer Edition downloads need no account but never expose the bucket. No egress fees. |

## How it fits together

```
Visitor ── "Free download"  → GET /api/download        → newest Windows build → 302 to 5-minute signed R2 URL
        ── quote/pilot form → POST /api/quote          → quote_requests table (+ optional Slack/Discord ping)
        ── Security summary → GET /api/resource        → signed R2 URL
Agency contact (signed in)
        ── Account page     → GET /api/me              → their agencies, licenses and license keys
        ── Vendor packet    → GET /api/resource        → signed R2 URL (sign-in required: it holds the W-9)
        ── Invoices         → POST /api/portal         → Stripe billing portal
You, in Stripe          → invoice / subscription paid → POST /api/stripe/webhook → licenses table
You, for pilots         → npm run agency:add -- …                            → agency + pilot license
```

Licenses are matched to Stripe by each Price's **lookup key** (`standard_annual`, `pro_perpetual`, `bundle_maintenance`, …).
See [docs/SETUP.md](docs/SETUP.md#2-stripe-billing).

## Local development

```bash
npm install
cp .env.example .env              # Supabase URL + anon/publishable key
cp .dev.vars.example .dev.vars    # Worker secrets (Stripe, Supabase service key, R2)
npm run preview                   # builds and serves site + API at http://localhost:8787
stripe listen --forward-to localhost:8787/api/stripe/webhook   # second terminal
```

| Command | Does |
| --- | --- |
| `npm run typecheck` | Astro + Worker type checks |
| `npm test` | Unit tests: Stripe → license rules, quote validation, signed URLs |
| `npm run build` | Static build to `dist/` |
| `npm run agency:add -- …` | Add an agency and its contacts, optionally with a pilot license |
| `npm run release:prepare -- <file> windows <version>` | Prints the upload command and SQL to publish an installer |

## Where to edit things

- Plan names, displayed prices, features, contact email, announcement bar: `src/config/site.ts`
- Page copy: `src/pages/index.astro`
- Colors and type: `src/styles/global.css`
- Documents offered for download: `RESOURCES` in `worker/routes/download.ts`
- Database schema: `supabase/migrations/`
