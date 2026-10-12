import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { HttpError, json } from '../lib/http';
import { adminClient } from '../lib/supabase';
import { planForPriceId, stripeClient } from '../lib/stripe';
import { hasAccess, type EntitlementRow } from '../lib/entitlement';

/**
 * POST /api/stripe/webhook
 * Stripe → this endpoint → `entitlements` table. The table is the single source of truth the
 * download endpoint checks, so access follows billing automatically (renewals, cancellations,
 * failed payments, refunds).
 */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) throw new HttpError(400, 'Missing Stripe signature.', 'bad_signature');

  const stripe = stripeClient(env);
  const payload = await request.text(); // raw body is required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new HttpError(400, 'Invalid Stripe signature.', 'bad_signature');
  }

  const db = adminClient(env);
  const seen = await db.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (seen.error) throw seen.error;
  if (seen.data) return json({ received: true, duplicate: true });

  await processStripeEvent(event, { stripe, db, env });

  // Recorded only after success, so a failed attempt is retried by Stripe.
  const rec = await db.from('stripe_events').upsert({ id: event.id, type: event.type }, { onConflict: 'id' });
  if (rec.error) console.warn('could not record stripe event', rec.error.message);
  return json({ received: true });
}

export interface WebhookDeps {
  stripe: Pick<Stripe, 'subscriptions' | 'charges' | 'paymentIntents'>;
  db: SupabaseClient;
  env: Env;
}

export async function processStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.mode === 'subscription' && typeof session.subscription === 'string') {
        await syncSubscription(session.subscription, deps);
      } else if (session.mode === 'payment' && session.payment_status === 'paid') {
        await grantLifetime(session, deps);
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      // Always re-read from Stripe: events can arrive out of order, the API cannot.
      await syncSubscription(event.data.object.id, deps);
      return;
    case 'charge.refunded':
    case 'charge.dispute.created':
      await revokeLifetimeForCharge(event, deps);
      return;
    default:
      return; // ignore everything else
  }
}

async function userIdForCustomer(db: SupabaseClient, customerId: string): Promise<string | null> {
  const { data, error } = await db.from('customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (error) throw error;
  return (data?.user_id as string | undefined) ?? null;
}

async function currentEntitlement(db: SupabaseClient, userId: string): Promise<EntitlementRow | null> {
  const { data, error } = await db.from('entitlements').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as EntitlementRow | null) ?? null;
}

async function upsertEntitlement(db: SupabaseClient, row: Omit<EntitlementRow, 'cancel_at_period_end'> & { cancel_at_period_end?: boolean }) {
  const { error } = await db
    .from('entitlements')
    .upsert({ cancel_at_period_end: false, ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

async function syncSubscription(subscriptionId: string, { stripe, db, env }: WebhookDeps): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.user_id || (await userIdForCustomer(db, customerId));
  if (!userId) {
    console.warn(`subscription ${sub.id}: no matching user for customer ${customerId}`);
    return;
  }

  const existing = await currentEntitlement(db, userId);
  // A lifetime license is never downgraded by subscription changes.
  if (existing?.plan === 'lifetime' && hasAccess(existing)) return;
  // Don't let an old, ended subscription overwrite a different one that is still active.
  if (existing && existing.stripe_subscription_id && existing.stripe_subscription_id !== sub.id && hasAccess(existing)) {
    if (!hasAccess({ plan: null, status: sub.status })) return;
  }

  const item = sub.items.data[0];
  await upsertEntitlement(db, {
    user_id: userId,
    plan: planForPriceId(item?.price.id, env) ?? existing?.plan ?? null,
    status: sub.status,
    stripe_subscription_id: sub.id,
    current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  });
}

async function grantLifetime(session: Stripe.Checkout.Session, { db }: WebhookDeps): Promise<void> {
  if (session.metadata?.plan !== 'lifetime') return;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const userId =
    session.client_reference_id || session.metadata?.user_id || (customerId ? await userIdForCustomer(db, customerId) : null);
  if (!userId) {
    console.warn(`checkout ${session.id}: no user to grant lifetime license to`);
    return;
  }
  await upsertEntitlement(db, {
    user_id: userId,
    plan: 'lifetime',
    status: 'active',
    stripe_subscription_id: null,
    current_period_end: null,
  });
}

/** A full refund or a dispute on a lifetime purchase removes access. Subscriptions follow Stripe's own status. */
async function revokeLifetimeForCharge(event: Stripe.Event, { stripe, db }: WebhookDeps): Promise<void> {
  let charge: Stripe.Charge;
  if (event.type === 'charge.refunded') {
    charge = event.data.object as Stripe.Charge;
    if (!charge.refunded) return; // partial refund keeps the license
  } else {
    const dispute = event.data.object as Stripe.Dispute;
    charge = typeof dispute.charge === 'string' ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
  }
  // Checkout stores { user_id, plan } on the PaymentIntent (payment_intent_data.metadata).
  let meta: Record<string, string> = charge.metadata ?? {};
  if (meta.plan !== 'lifetime' && charge.payment_intent) {
    const pi =
      typeof charge.payment_intent === 'string'
        ? await stripe.paymentIntents.retrieve(charge.payment_intent)
        : charge.payment_intent;
    meta = pi.metadata ?? {};
  }
  if (meta.plan !== 'lifetime') return;
  const userId =
    meta.user_id ||
    (typeof charge.customer === 'string' ? await userIdForCustomer(db, charge.customer) : null);
  if (!userId) return;
  await setLifetimeStatus(db, userId, event.type === 'charge.refunded' ? 'refunded' : 'disputed');
}

async function setLifetimeStatus(db: SupabaseClient, userId: string, status: string) {
  const existing = await currentEntitlement(db, userId);
  if (existing?.plan !== 'lifetime') return;
  await upsertEntitlement(db, { ...existing, status });
}
