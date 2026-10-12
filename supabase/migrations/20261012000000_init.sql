-- Blueline PDF — accounts, licenses, releases.
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Security model: the browser only ever reads its own rows (RLS). Every write happens in the
-- Cloudflare Worker with the service-role key, which bypasses RLS. No client-side write policies exist.

-- Stripe customer per user ------------------------------------------------------------------------
create table public.customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- One license row per user, kept in sync by the Stripe webhook ------------------------------------
create table public.entitlements (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  plan                   text check (plan in ('monthly', 'yearly', 'lifetime')),
  -- Stripe subscription status (active, trialing, past_due, canceled, unpaid, incomplete, …)
  -- or, for lifetime: active | refunded | disputed
  status                 text not null,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

-- Installer builds stored in the private R2 bucket ------------------------------------------------
create table public.releases (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform ~ '^[a-z0-9-]{2,32}$'),   -- e.g. windows, macos, linux
  version      text not null,
  r2_key       text not null unique,                                  -- object key inside the bucket
  filename     text not null,                                         -- name the user's browser saves
  sha256       text,
  size_bytes   bigint,
  notes_url    text,
  published    boolean not null default false,
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (platform, version)
);
create index releases_latest_idx on public.releases (platform, published_at desc) where published;

-- Audit trail of issued download links -------------------------------------------------------------
create table public.download_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  release_id  uuid not null references public.releases (id) on delete cascade,
  ip_country  text,
  created_at  timestamptz not null default now()
);
create index download_events_user_idx on public.download_events (user_id, created_at desc);

-- Processed Stripe webhook events (idempotency) ----------------------------------------------------
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- Row-level security -------------------------------------------------------------------------------
alter table public.customers       enable row level security;
alter table public.entitlements    enable row level security;
alter table public.releases        enable row level security;
alter table public.download_events enable row level security;
alter table public.stripe_events   enable row level security;

create policy "read own customer"      on public.customers       for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own entitlement"   on public.entitlements    for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own downloads"     on public.download_events for select to authenticated using ((select auth.uid()) = user_id);
-- releases and stripe_events: no client policies. r2_key never leaves the Worker.

-- Lock the tables down for the public API roles; RLS above re-opens only the rows each user owns.
revoke all on public.customers, public.entitlements, public.releases, public.download_events, public.stripe_events from anon;
revoke insert, update, delete on public.customers, public.entitlements, public.download_events from authenticated;
revoke all on public.releases, public.stripe_events from authenticated;
