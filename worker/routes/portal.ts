import type { Env } from '../env';
import { HttpError, assertSameOrigin, json } from '../lib/http';
import { requireUser } from '../lib/supabase';
import { stripeClient } from '../lib/stripe';

export async function handlePortal(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request, env.SITE_URL);
  const { user, db } = await requireUser(request, env);

  const row = await db.from('customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) throw new HttpError(404, 'No billing history yet. Choose a plan first.', 'no_customer');

  const session = await stripeClient(env).billingPortal.sessions.create({
    customer: row.data.stripe_customer_id as string,
    return_url: `${env.SITE_URL.replace(/\/$/, '')}/account/`,
  });
  return json({ url: session.url });
}
