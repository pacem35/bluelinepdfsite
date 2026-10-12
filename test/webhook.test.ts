import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { handleStripeWebhook, processStripeEvent } from '../worker/routes/webhook';
import { errorResponse } from '../worker/lib/http';
import type { Env } from '../worker/env';
import { fakeDb } from './fake-db';

const env = {
  SITE_URL: 'https://blueline.example',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
} as unknown as Env;

const ev = (type: string, object: unknown) => ({ id: `evt_${Math.random()}`, type, data: { object } }) as unknown as Stripe.Event;
const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function stripeStub(opts: { subs?: Record<string, any>; prices?: Record<string, string>; customers?: Record<string, any> } = {}) {
  return {
    subscriptions: { retrieve: vi.fn(async (id: string) => opts.subs?.[id]) },
    prices: { retrieve: vi.fn(async (id: string) => ({ id, lookup_key: opts.prices?.[id] ?? null })) },
    customers: {
      retrieve: vi.fn(async (id: string) => opts.customers?.[id] ?? { id, name: 'Fulton Police Department', email: 'Records@Fulton.gov', metadata: { ori: 'MO0140100' } }),
    },
    invoices: { listLineItems: vi.fn() },
  } as any;
}

const sub = (o: Partial<any> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  items: { data: [{ quantity: 5, current_period_end: ts('2027-10-12T00:00:00Z'), price: { id: 'price_std', lookup_key: 'standard_annual' } }] },
  ...o,
});

const invoice = (lines: any[], paid = '2026-11-01T00:00:00Z') => ({
  id: 'in_1',
  customer: 'cus_1',
  status_transitions: { paid_at: ts(paid) },
  lines: { has_more: false, data: lines },
});
const line = (id: string, price: string, quantity = 1) => ({ id, quantity, parent: { type: 'invoice_item_details', subscription_item_details: null }, pricing: { price_details: { price } } });

describe('annual subscriptions', () => {
  it('creates the agency, its contact and a 5-seat license', async () => {
    const { db, tables } = fakeDb();
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_1' }), { stripe: stripeStub({ subs: { sub_1: sub() } }), db });

    expect(tables.agencies).toHaveLength(1);
    expect(tables.agencies![0]).toMatchObject({ name: 'Fulton Police Department', ori: 'MO0140100', stripe_customer_id: 'cus_1' });
    expect(tables.agency_members![0]).toMatchObject({ email: 'records@fulton.gov', role: 'admin' });
    expect(tables.licenses![0]).toMatchObject({
      plan: 'standard', kind: 'subscription', seats: 5, status: 'active', stripe_subscription_id: 'sub_1',
      current_period_end: '2027-10-12T00:00:00.000Z', agency_id: tables.agencies![0]!.id,
    });
    expect(tables.licenses![0]!.license_key).toMatch(/^BL-/);
  });

  it('keeps the same license key through updates and cancellation', async () => {
    const { db, tables } = fakeDb();
    const stripe = stripeStub({ subs: { sub_1: sub() } });
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_1' }), { stripe, db });
    const key = tables.licenses![0]!.license_key;

    stripe.subscriptions.retrieve.mockResolvedValue(sub({ cancel_at_period_end: true, items: { data: [{ quantity: 8, current_period_end: 1, price: { id: 'p', lookup_key: 'pro_annual' } }] } }));
    await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), { stripe, db });
    expect(tables.licenses![0]).toMatchObject({ license_key: key, plan: 'pro', seats: 8, cancel_at_period_end: true });

    stripe.subscriptions.retrieve.mockResolvedValue(sub({ status: 'canceled' }));
    await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), { stripe, db });
    expect(tables.licenses).toHaveLength(1);
    expect(tables.licenses![0]).toMatchObject({ license_key: key, status: 'canceled' });
    expect(tables.agencies).toHaveLength(1);
  });

  it('counts a bundle subscription as 10 seats', async () => {
    const { db, tables } = fakeDb();
    const s = sub({ items: { data: [{ quantity: 1, current_period_end: 1, price: { id: 'p', lookup_key: 'bundle_annual' } }] } });
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_1' }), { stripe: stripeStub({ subs: { sub_1: s } }), db });
    expect(tables.licenses![0]).toMatchObject({ plan: 'bundle', seats: 10 });
  });

  it('ignores subscriptions for prices without a Blueline lookup key', async () => {
    const { db, tables } = fakeDb();
    const s = sub({ items: { data: [{ quantity: 1, current_period_end: 1, price: { id: 'p', lookup_key: null } }] } });
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_1' }), { stripe: stripeStub({ subs: { sub_1: s } }), db });
    expect(tables.licenses ?? []).toHaveLength(0);
  });

  it('links to an existing agency (e.g. from a pilot) through customer metadata', async () => {
    const { db, tables } = fakeDb({ agencies: [{ id: 'ag-pilot', name: 'Fulton PD', ori: null, stripe_customer_id: null }] });
    const stripe = stripeStub({ subs: { sub_1: sub() }, customers: { cus_1: { id: 'cus_1', name: 'x', email: 'chief@fulton.gov', metadata: { agency_id: 'ag-pilot' } } } });
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_1' }), { stripe, db });
    expect(tables.agencies).toHaveLength(1);
    expect(tables.agencies![0]).toMatchObject({ id: 'ag-pilot', stripe_customer_id: 'cus_1' });
    expect(tables.licenses![0]).toMatchObject({ agency_id: 'ag-pilot' });
  });
});

describe('paid one-off invoices', () => {
  it('a perpetual purchase creates a license with a year of maintenance, once', async () => {
    const { db, tables } = fakeDb();
    const stripe = stripeStub({ prices: { price_pp: 'pro_perpetual' } });
    const inv = invoice([line('il_1', 'price_pp', 3)]);
    await processStripeEvent(ev('invoice.paid', inv), { stripe, db });
    await processStripeEvent(ev('invoice.paid', inv), { stripe, db }); // redelivery with a new event id
    expect(tables.licenses).toHaveLength(1);
    expect(tables.licenses![0]).toMatchObject({ plan: 'pro', kind: 'perpetual', seats: 3, status: 'active', maintenance_until: '2027-11-01T00:00:00.000Z' });
  });

  it('a maintenance invoice adds a year to that plan’s perpetual licenses', async () => {
    const { db, tables } = fakeDb({
      agencies: [{ id: 'ag1', name: 'PD', stripe_customer_id: 'cus_1' }],
      licenses: [
        { id: 'l1', agency_id: 'ag1', license_key: 'BL-1', plan: 'standard', kind: 'perpetual', seats: 4, status: 'active', maintenance_until: '2027-01-15T00:00:00.000Z' },
        { id: 'l2', agency_id: 'ag1', license_key: 'BL-2', plan: 'pro', kind: 'perpetual', seats: 1, status: 'active', maintenance_until: '2027-01-15T00:00:00.000Z' },
      ],
    });
    await processStripeEvent(ev('invoice.paid', invoice([line('il_m', 'price_m')], '2027-01-02T00:00:00Z')), {
      stripe: stripeStub({ prices: { price_m: 'standard_maintenance' } }), db,
    });
    expect(tables.licenses!.find((l) => l.id === 'l1')!.maintenance_until).toBe('2028-01-15T00:00:00.000Z');
    expect(tables.licenses!.find((l) => l.id === 'l2')!.maintenance_until).toBe('2027-01-15T00:00:00.000Z');
  });

  it('a one-off annual invoice starts a term license and renewals extend it', async () => {
    const { db, tables } = fakeDb();
    const stripe = stripeStub({ prices: { price_sa: 'standard_annual' } });
    await processStripeEvent(ev('invoice.paid', invoice([line('il_a', 'price_sa', 6)], '2026-11-01T00:00:00Z')), { stripe, db });
    expect(tables.licenses![0]).toMatchObject({ kind: 'term', seats: 6, expires_at: '2027-11-01T00:00:00.000Z' });
    const key = tables.licenses![0]!.license_key;

    await processStripeEvent(ev('invoice.paid', invoice([line('il_b', 'price_sa', 9)], '2027-10-15T00:00:00Z')), { stripe, db });
    expect(tables.licenses).toHaveLength(1);
    expect(tables.licenses![0]).toMatchObject({ license_key: key, seats: 9, expires_at: '2028-11-01T00:00:00.000Z' });
  });

  it('a subscription renewal invoice re-syncs the subscription', async () => {
    const { db, tables } = fakeDb();
    const subLine = { id: 'il_s', quantity: 5, parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_1' } }, pricing: null };
    await processStripeEvent(ev('invoice.paid', invoice([subLine])), { stripe: stripeStub({ subs: { sub_1: sub() } }), db });
    expect(tables.licenses![0]).toMatchObject({ kind: 'subscription', stripe_subscription_id: 'sub_1' });
  });
});

describe('handleStripeWebhook signature check', () => {
  afterEach(() => vi.unstubAllGlobals());
  const call = async (headers: Record<string, string>, body: string) => {
    try {
      return await handleStripeWebhook(new Request('https://x/api/stripe/webhook', { method: 'POST', headers, body }), env);
    } catch (e) {
      return errorResponse(e);
    }
  };

  it('rejects a request with no signature', async () => expect((await call({}, '{}')).status).toBe(400));
  it('rejects a forged signature', async () => expect((await call({ 'stripe-signature': 't=1,v1=deadbeef' }, '{}')).status).toBe(400));

  it('accepts a correctly signed event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
    const payload = JSON.stringify({ id: 'evt_ok', object: 'event', type: 'customer.created', data: { object: {} } });
    const header = new Stripe('sk_test_123').webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
    const res = await call({ 'stripe-signature': header }, payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});
