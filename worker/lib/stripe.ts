import Stripe from 'stripe';
import type { Env } from '../env';
import { HttpError } from './http';

export function stripeClient(env: Env): Stripe {
  // The "workerd" export of the SDK uses fetch + Web Crypto, so no Node shims are needed.
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}

export type PlanId = 'monthly' | 'yearly' | 'lifetime';

export function priceIdFor(plan: PlanId, env: Env): string {
  const id = {
    monthly: env.STRIPE_PRICE_MONTHLY,
    yearly: env.STRIPE_PRICE_YEARLY,
    lifetime: env.STRIPE_PRICE_LIFETIME,
  }[plan];
  if (!id) throw new HttpError(400, `The ${plan} plan isn't available.`, 'plan_unavailable');
  return id;
}

export function planForPriceId(priceId: string | undefined, env: Env): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_MONTHLY) return 'monthly';
  if (priceId === env.STRIPE_PRICE_YEARLY) return 'yearly';
  if (priceId === env.STRIPE_PRICE_LIFETIME) return 'lifetime';
  return null;
}
