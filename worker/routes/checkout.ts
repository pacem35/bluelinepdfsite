import type { Env } from '../env';
import { HttpError, assertSameOrigin, json, readJson } from '../lib/http';
import { requireUser } from '../lib/supabase';
import { priceIdFor, stripeClient, type PlanId } from '../lib/stripe';
import { hasAccess } from '../lib/entitlement';
import { getOrCreateCustomer } from './customer';

const PLANS: PlanId[] = ['monthly', 'yearly', 'lifetime'];

export async function handleCheckout(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request, env.SITE_URL);
  const { user, db } = await requireUser(request, env);
  const body = await readJson<{ plan?: string }>(request);
  const plan = body.plan as PlanId;
  if (!PLANS.includes(plan)) throw new HttpError(400, 'Choose a plan.', 'bad_request');

  const current = await db.from('entitlements').select('plan,status').eq('user_id', user.id).maybeSingle();
  if (current.error) throw current.error;
  if (hasAccess(current.data)) {
    throw new HttpError(409, 'You already have an active license. Manage it from your account.', 'already_licensed');
  }

  const stripe = stripeClient(env);
  const customer = await getOrCreateCustomer(stripe, db, user);
  const price = priceIdFor(plan, env);
  const site = env.SITE_URL.replace(/\/$/, '');

  const session = await stripe.checkout.sessions.create({
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    mode: plan === 'lifetime' ? 'payment' : 'subscription',
    allow_promotion_codes: true,
    automatic_tax: { enabled: false }, // turn on once Stripe Tax is configured
    metadata: { user_id: user.id, plan },
    ...(plan === 'lifetime'
      ? { payment_intent_data: { metadata: { user_id: user.id, plan } } }
      : { subscription_data: { metadata: { user_id: user.id } } }),
    success_url: `${site}/account/?checkout=success`,
    cancel_url: `${site}/pricing/?checkout=cancelled`,
  });

  if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout link.', 'stripe_error');
  return json({ url: session.url });
}
