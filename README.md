# Blueline PDF — website

Marketing site, accounts, billing and installer downloads for Blueline PDF.

| Concern | Choice | Why |
| --- | --- | --- |
| Hosting | **Cloudflare Workers** (static assets + API in one Worker), deployed from this repo on every push | Free tier allows commercial use (Vercel's free Hobby plan doesn't). Static pages are served free and without limit; only `/api/*` calls count toward the 100k requests/day free allowance. Cloudflare now recommends Workers over Pages for new projects, with the same Git-connected deploys. |
| Auth + database | **Supabase** | One service for sign-in (email + password, magic links) and Postgres. Clerk would still need a separate database for licenses. |
| Billing | **Stripe** Checkout + Customer Portal + a webhook at `/api/stripe/webhook` | Stripe hosts the payment and billing pages; the webhook keeps each user's license in sync. |
| Installers | **Cloudflare R2**, private bucket, presigned URLs that expire after 5 minutes | Same account as the site, 10 GB free storage and no egress fees, so downloads cost nothing. |

## How it fits together

```
Browser ── static pages (Astro, ./dist) ─────────────── served by Cloudflare's asset layer
   │
   ├─ Supabase Auth (sign in, session token)
   │
   └─ /api/* ──► Worker (worker/index.ts)
                   ├─ POST /api/checkout        → Stripe Checkout session
                   ├─ POST /api/portal          → Stripe billing portal
                   ├─ GET  /api/me              → license status
                   ├─ GET  /api/releases        → latest build per platform
                   ├─ GET  /api/download        → license check → 5-minute signed R2 URL
                   └─ POST /api/stripe/webhook  → verifies signature → updates `entitlements`
```

The `entitlements` table in Supabase is the single source of truth for "may this person download?".
Only the Worker writes to it (service-role key); browsers can only read their own row.

## Local development

```bash
npm install
cp .env.example .env              # Supabase URL + anon/publishable key
cp .dev.vars.example .dev.vars    # Worker secrets (Stripe, Supabase service key, R2)
npm run preview                   # builds and serves site + API at http://localhost:8787
stripe listen --forward-to localhost:8787/api/stripe/webhook   # in a second terminal
```

`npm run dev` serves pages only (fast UI work, no `/api`).

| Command | Does |
| --- | --- |
| `npm run typecheck` | Astro + Worker type checks |
| `npm test` | Unit tests: webhook → license logic, signed URLs, access rules |
| `npm run build` | Static build to `dist/` |
| `npm run release:prepare -- <file> <platform> <version>` | Prints the upload command and SQL to publish an installer |

## Setup

Account setup, keys and go-live steps: **[docs/SETUP.md](docs/SETUP.md)**.

## Where to edit things

- Prices shown, feature list, support email: `src/config/site.ts`
- Charged prices: Stripe Price IDs in `wrangler.jsonc` → `vars`
- Colors and type: `src/styles/global.css`
- Database schema: `supabase/migrations/`
