-- Blueline — agencies, licenses, quote requests, installer releases.
-- Apply with `supabase db push`, or paste into the Supabase SQL editor.
--
-- Security model: browsers never query these tables. Every read and write goes through the
-- Cloudflare Worker using the service-role key. RLS is on with no policies, so the public
-- anon/authenticated roles can see nothing even if someone calls the Supabase API directly.

create extension if not exists citext;

-- Agencies (one Stripe customer each) --------------------------------------------------------------
create table public.agencies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  ori                text,
  stripe_customer_id text unique,
  created_at         timestamptz not null default now()
);

-- People who may sign in and see an agency's licenses, matched by verified email ------------------
create table public.agency_members (
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  email      citext not null,
  role       text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (agency_id, email)
);
create index agency_members_email_idx on public.agency_members (email);

-- Licenses ---------------------------------------------------------------------------------------
--  kind = subscription : annual plan on a Stripe subscription that re-invoices itself each year (Net 30)
--  kind = term         : annual plan bought on a one-off invoice; each paid renewal invoice adds a year to expires_at
--  kind = perpetual    : one-time purchase; never expires; maintenance_until controls access to updates
--  kind = pilot        : free 60–90 day pilot; expires_at ends it
create table public.licenses (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references public.agencies (id) on delete cascade,
  license_key            text not null unique,
  plan                   text not null check (plan in ('standard', 'bundle', 'pro')),
  kind                   text not null check (kind in ('subscription', 'term', 'perpetual', 'pilot')),
  seats                  integer not null check (seats > 0),
  -- subscription: Stripe status (active, past_due, canceled, …); other kinds: active | revoked
  status                 text not null default 'active',
  stripe_subscription_id text unique,
  stripe_invoice_line_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  maintenance_until      timestamptz,
  expires_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index licenses_agency_idx on public.licenses (agency_id);

-- "Request a quote" / pilot form submissions -------------------------------------------------------
create table public.quote_requests (
  id          uuid primary key default gen_random_uuid(),
  agency_name text not null,
  ori         text,
  seats       integer,
  email       citext not null,
  contacts    text,
  ip_country  text,
  status      text not null default 'new' check (status in ('new', 'contacted', 'pilot', 'won', 'lost')),
  created_at  timestamptz not null default now()
);
create index quote_requests_created_idx on public.quote_requests (created_at desc);

-- Installer builds in the private R2 bucket --------------------------------------------------------
create table public.releases (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform ~ '^[a-z0-9-]{2,32}$'),
  version      text not null,
  r2_key       text not null unique,
  filename     text not null,
  sha256       text,
  size_bytes   bigint,
  notes_url    text,
  published    boolean not null default false,
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (platform, version)
);
create index releases_latest_idx on public.releases (platform, published_at desc) where published;

-- Download log (anonymous for the free edition) ----------------------------------------------------
create table public.download_events (
  id         bigint generated always as identity primary key,
  release_id uuid references public.releases (id) on delete set null,
  resource   text,
  user_id    uuid references auth.users (id) on delete set null,
  ip_country text,
  created_at timestamptz not null default now()
);
create index download_events_created_idx on public.download_events (created_at desc);

-- Processed Stripe webhook events (idempotency) ----------------------------------------------------
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- Lock everything down for the public API roles ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agencies','agency_members','licenses','quote_requests','releases','download_events','stripe_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
