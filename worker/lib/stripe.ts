import Stripe from 'stripe';
import type { Env } from '../env';

export function stripeClient(env: Env): Stripe {
  // The "workerd" export of the SDK uses fetch + Web Crypto, so no Node shims are needed.
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}
