import type { Env } from '../env';
import { HttpError, assertSameOrigin, json, readJson } from '../lib/http';
import { agencyIdsFor, requireUser } from '../lib/supabase';
import { stripeClient } from '../lib/stripe';

/** POST /api/portal { agencyId } — Stripe's hosted page for invoices, payment methods and receipts. */
export async function handlePortal(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request, env.SITE_URL);
  const { user, db } = await requireUser(request, env);
  const { agencyId } = await readJson<{ agencyId?: string }>(request);

  const ids = await agencyIdsFor(db, user.email);
  if (!agencyId || !ids.includes(agencyId)) throw new HttpError(403, 'You aren’t listed as a contact for that agency.', 'forbidden');

  const row = await db.from('agencies').select('stripe_customer_id').eq('id', agencyId).single();
  if (row.error) throw row.error;
  if (!row.data.stripe_customer_id) throw new HttpError(404, 'No invoices for this agency yet.', 'no_customer');

  const session = await stripeClient(env).billingPortal.sessions.create({
    customer: row.data.stripe_customer_id as string,
    return_url: `${env.SITE_URL.replace(/\/$/, '')}/account/`,
  });
  return json({ url: session.url });
}
