import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { handleStripeWebhook, processStripeEvent } from '../worker/routes/webhook';
import { errorResponse } from '../worker/lib/http';
import type { Env } from '../worker/env';
import { fakeDb } from './fake-db';

const env = {
  SITE_URL: 'https://bluelinepdf.example',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
  STRIPE_PRICE_LIFETIME: 'price_life',
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
} as unknown as Env;

const ev = (type: string, object: unknown) => ({ id: `evt_${Math.random()}`, type, data: { object } }) as unknown as Stripe.Event;

function stripeStub(subs: Record<string, any> = {}, extra: Partial<Record<'charges' | 'paymentIntents', any>> = {}) {
  return {
    subscriptions: { retrieve: vi.fn(async (id: string) => subs[id]) },
    charges: extra.charges ?? { retrieve: vi.fn() },
    paymentIntents: extra.paymentIntents ?? { retrieve: vi.fn() },
  } as any;
}

const sub = (o: Partial<any> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  metadata: { user_id: 'user-1' },
  cancel_at_period_end: false,
  cancel_at: null,
  items: { data: [{ price: { id: 'price_year' }, current_period_end: 1893456000 }] },
  ...o,
});

describe('processStripeEvent', () => {
  it('activates a yearly subscription after checkout', async () => {
    const { db, tables } = fakeDb();
    await processStripeEvent(
      ev('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1' }),
      { stripe: stripeStub({ sub_1: sub() }), db, env },
    );
    expect(tables.entitlements![0]).toMatchObject({
      user_id: 'user-1', plan: 'yearly', status: 'active', stripe_subscription_id: 'sub_1',
      current_period_end: new Date(1893456000 * 1000).toISOString(), cancel_at_period_end: false,
    });
  });

  it('marks cancellation and then removes access when the subscription ends', async () => {
    const { db, tables } = fakeDb();
    const stripe = stripeStub({ sub_1: sub({ cancel_at_period_end: true }) });
    await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), { stripe, db, env });
    expect(tables.entitlements![0]).toMatchObject({ status: 'active', cancel_at_period_end: true });

    stripe.subscriptions.retrieve.mockResolvedValue(sub({ status: 'canceled' }));
    await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), { stripe, db, env });
    expect(tables.entitlements![0]).toMatchObject({ status: 'canceled' });
  });

  it('finds the user through the customers table when metadata is missing', async () => {
    const { db, tables } = fakeDb({ customers: [{ user_id: 'user-9', stripe_customer_id: 'cus_9' }] });
    await processStripeEvent(ev('customer.subscription.created', { id: 'sub_9' }), {
      stripe: stripeStub({ sub_9: sub({ id: 'sub_9', customer: 'cus_9', metadata: {} , items: { data: [{ price: { id: 'price_month' }, current_period_end: 1 }] } }) }),
      db, env,
    });
    expect(tables.entitlements![0]).toMatchObject({ user_id: 'user-9', plan: 'monthly' });
  });

  it('grants a lifetime license for a paid one-time checkout', async () => {
    const { db, tables } = fakeDb();
    await processStripeEvent(
      ev('checkout.session.completed', {
        id: 'cs_1', mode: 'payment', payment_status: 'paid', client_reference_id: 'user-2',
        customer: 'cus_2', metadata: { user_id: 'user-2', plan: 'lifetime' },
      }),
      { stripe: stripeStub(), db, env },
    );
    expect(tables.entitlements![0]).toMatchObject({ user_id: 'user-2', plan: 'lifetime', status: 'active' });
  });

  it('does not grant lifetime while an async payment is still pending', async () => {
    const { db, tables } = fakeDb();
    await processStripeEvent(
      ev('checkout.session.completed', { mode: 'payment', payment_status: 'unpaid', client_reference_id: 'u', metadata: { plan: 'lifetime' } }),
      { stripe: stripeStub(), db, env },
    );
    expect(tables.entitlements ?? []).toHaveLength(0);
  });

  it('never lets a subscription event downgrade a lifetime license', async () => {
    const { db, tables } = fakeDb({
      entitlements: [{ user_id: 'user-1', plan: 'lifetime', status: 'active', stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false }],
    });
    await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), {
      stripe: stripeStub({ sub_1: sub({ status: 'canceled' }) }), db, env,
    });
    expect(tables.entitlements![0]).toMatchObject({ plan: 'lifetime', status: 'active' });
  });

  it('revokes lifetime access on a full refund', async () => {
    const { db, tables } = fakeDb({
      customers: [{ user_id: 'user-3', stripe_customer_id: 'cus_3' }],
      entitlements: [{ user_id: 'user-3', plan: 'lifetime', status: 'active', stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false }],
    });
    const paymentIntents = { retrieve: vi.fn(async () => ({ metadata: { plan: 'lifetime', user_id: 'user-3' } })) };
    await processStripeEvent(
      ev('charge.refunded', { refunded: true, customer: 'cus_3', metadata: {}, payment_intent: 'pi_3' }),
      { stripe: stripeStub({}, { paymentIntents }), db, env },
    );
    expect(paymentIntents.retrieve).toHaveBeenCalledWith('pi_3');
    expect(tables.entitlements![0]).toMatchObject({ status: 'refunded' });
  });

  it('keeps lifetime access on a partial refund', async () => {
    const { db, tables } = fakeDb({
      entitlements: [{ user_id: 'user-3', plan: 'lifetime', status: 'active', stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false }],
    });
    await processStripeEvent(ev('charge.refunded', { refunded: false, metadata: { plan: 'lifetime', user_id: 'user-3' } }), {
      stripe: stripeStub(), db, env,
    });
    expect(tables.entitlements![0]).toMatchObject({ status: 'active' });
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

  it('rejects a request with no signature', async () => {
    expect((await call({}, '{}')).status).toBe(400);
  });

  it('rejects a forged signature', async () => {
    expect((await call({ 'stripe-signature': 't=1,v1=deadbeef' }, '{}')).status).toBe(400);
  });

  it('accepts a correctly signed event', async () => {
    // Supabase REST calls (idempotency lookup + record) answered with empty results.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
    const payload = JSON.stringify({ id: 'evt_ok', object: 'event', type: 'customer.created', data: { object: {} } });
    const header = new Stripe('sk_test_123').webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
    const res = await call({ 'stripe-signature': header }, payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});
