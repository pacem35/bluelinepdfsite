import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { HttpError, json } from '../lib/http';
import { adminClient } from '../lib/supabase';
import { stripeClient } from '../lib/stripe';
import { extendOneYear, generateLicenseKey, parseLookupKey, seatsFor, type LicenseRow } from '../lib/licenses';

/**
 * POST /api/stripe/webhook
 *
 * You run billing from the Stripe dashboard (quotes → invoices, Net 30). This endpoint watches what
 * Stripe does and keeps the `licenses` table in step:
 *
 *   annual subscription (price lookup key  *_annual, on a subscription)  → license kind "subscription"
 *   one-off invoice for  *_annual                                          → license kind "term" (+1 year per paid invoice)
 *   one-off invoice for  *_perpetual                                       → license kind "perpetual" (+1 year maintenance)
 *   one-off invoice for  *_maintenance                                     → +1 year maintenance on that plan's perpetual license(s)
 *
 * Agencies are matched by Stripe customer, created automatically the first time a customer is billed.
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

  await processStripeEvent(event, { stripe, db });

  // Recorded only after success, so a failed attempt is retried by Stripe.
  const rec = await db.from('stripe_events').upsert({ id: event.id, type: event.type }, { onConflict: 'id' });
  if (rec.error) console.warn('could not record stripe event', rec.error.message);
  return json({ received: true });
}

export interface WebhookDeps {
  stripe: Pick<Stripe, 'subscriptions' | 'customers' | 'prices' | 'invoices'>;
  db: SupabaseClient;
  now?: () => Date;
}

export async function processStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      // Always re-read from Stripe: events can arrive out of order, the API cannot.
      await syncSubscription(event.data.object.id, deps);
      return;
    case 'invoice.paid':
      await applyPaidInvoice(event.data.object, deps);
      return;
    default:
      return;
  }
}

// --- agencies --------------------------------------------------------------------------------------

async function ensureAgency(customerId: string, { stripe, db }: WebhookDeps): Promise<string | null> {
  const found = await db.from('agencies').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data.id as string;

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;

  // Customer created by `npm run agency:add` (e.g. after a pilot) carries the agency id.
  const linked = customer.metadata?.agency_id;
  if (linked) {
    const upd = await db.from('agencies').update({ stripe_customer_id: customerId }).eq('id', linked).select('id').maybeSingle();
    if (upd.error) throw upd.error;
    if (upd.data) {
      await addMember(db, linked, customer.email);
      return linked;
    }
  }

  const ins = await db
    .from('agencies')
    .insert({ name: customer.name || customer.email || 'Unnamed agency', ori: customer.metadata?.ori || null, stripe_customer_id: customerId })
    .select('id')
    .single();
  if (ins.error) {
    // Another webhook delivery created it a moment ago.
    const again = await db.from('agencies').select('id').eq('stripe_customer_id', customerId).single();
    if (again.error) throw ins.error;
    return again.data.id as string;
  }
  await addMember(db, ins.data.id as string, customer.email);
  return ins.data.id as string;
}

async function addMember(db: SupabaseClient, agencyId: string, email: string | null | undefined) {
  if (!email) return;
  const { error } = await db
    .from('agency_members')
    .upsert({ agency_id: agencyId, email: email.toLowerCase(), role: 'admin' }, { onConflict: 'agency_id,email', ignoreDuplicates: true });
  if (error) throw error;
}

// --- licenses -------------------------------------------------------------------------------------

async function findLicense(db: SupabaseClient, column: string, value: string): Promise<LicenseRow | null> {
  const { data, error } = await db.from('licenses').select('*').eq(column, value).maybeSingle();
  if (error) throw error;
  return (data as LicenseRow | null) ?? null;
}

async function saveLicense(db: SupabaseClient, existing: LicenseRow | null, fields: Partial<LicenseRow>) {
  const updated_at = new Date().toISOString();
  if (existing) {
    const { error } = await db.from('licenses').update({ ...fields, updated_at }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from('licenses').insert({ license_key: generateLicenseKey(), status: 'active', ...fields, updated_at });
    if (error) throw error;
  }
}

async function syncSubscription(subscriptionId: string, deps: WebhookDeps): Promise<void> {
  const { stripe, db } = deps;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data.find((i) => parseLookupKey(i.price.lookup_key)?.kind === 'annual');
  const parsed = parseLookupKey(item?.price.lookup_key);
  if (!item || !parsed) {
    console.warn(`subscription ${sub.id}: no price with a <plan>_annual lookup key; ignored`);
    return;
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const agencyId = await ensureAgency(customerId, deps);
  if (!agencyId) return;

  await saveLicense(db, await findLicense(db, 'stripe_subscription_id', sub.id), {
    agency_id: agencyId,
    plan: parsed.plan,
    kind: 'subscription',
    seats: seatsFor(parsed.plan, item.quantity),
    status: sub.status,
    stripe_subscription_id: sub.id,
    current_period_end: item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  });
}

async function invoiceLines(invoice: Stripe.Invoice, stripe: WebhookDeps['stripe']): Promise<Stripe.InvoiceLineItem[]> {
  if (!invoice.lines.has_more || !invoice.id) return invoice.lines.data;
  const all: Stripe.InvoiceLineItem[] = [];
  for await (const line of stripe.invoices.listLineItems(invoice.id, { limit: 100 })) all.push(line);
  return all;
}

async function applyPaidInvoice(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<void> {
  const { stripe, db } = deps;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : (deps.now?.() ?? new Date());

  const priceCache = new Map<string, Stripe.Price>();
  let agencyId: string | null | undefined;

  for (const line of await invoiceLines(invoice, stripe)) {
    // Subscription renewals: re-sync the subscription itself.
    const subId = line.parent?.subscription_item_details?.subscription;
    if (subId) {
      await syncSubscription(subId, deps);
      continue;
    }

    const ref = line.pricing?.price_details?.price;
    if (!ref) continue;
    let price = typeof ref === 'string' ? priceCache.get(ref) : ref;
    if (!price && typeof ref === 'string') {
      price = await stripe.prices.retrieve(ref);
      priceCache.set(ref, price);
    }
    const parsed = parseLookupKey(price?.lookup_key);
    if (!parsed) continue;

    agencyId ??= await ensureAgency(customerId, deps);
    if (!agencyId) return;
    const seats = seatsFor(parsed.plan, line.quantity);

    if (parsed.kind === 'perpetual') {
      const existing = await findLicense(db, 'stripe_invoice_line_id', line.id);
      if (existing) continue;
      await saveLicense(db, null, {
        agency_id: agencyId,
        plan: parsed.plan,
        kind: 'perpetual',
        seats,
        stripe_invoice_line_id: line.id,
        maintenance_until: extendOneYear(null, paidAt),
      });
    } else if (parsed.kind === 'annual') {
      // One-off annual invoice: renew the agency's existing term license for this plan, or start one.
      const { data, error } = await db
        .from('licenses')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('plan', parsed.plan)
        .eq('kind', 'term')
        .maybeSingle();
      if (error) throw error;
      const existing = data as LicenseRow | null;
      await saveLicense(db, existing, {
        agency_id: agencyId,
        plan: parsed.plan,
        kind: 'term',
        seats,
        status: 'active',
        expires_at: extendOneYear(existing?.expires_at ?? null, paidAt),
      });
    } else if (parsed.kind === 'maintenance') {
      const { data, error } = await db
        .from('licenses')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('plan', parsed.plan)
        .eq('kind', 'perpetual');
      if (error) throw error;
      const rows = (data ?? []) as LicenseRow[];
      if (rows.length === 0) console.warn(`invoice ${invoice.id}: maintenance paid but agency has no ${parsed.plan} perpetual license`);
      for (const l of rows) {
        await saveLicense(db, l, { maintenance_until: extendOneYear(l.maintenance_until, paidAt) });
      }
    }
  }
}
