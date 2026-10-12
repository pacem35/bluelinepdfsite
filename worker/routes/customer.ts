import type Stripe from 'stripe';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/** Returns the Stripe customer for this user, creating and recording one on first use. */
export async function getOrCreateCustomer(stripe: Stripe, db: SupabaseClient, user: User): Promise<string> {
  const existing = await db.from('customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.stripe_customer_id as string;

  const customer = await stripe.customers.create(
    { email: user.email, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-create-${user.id}` },
  );

  const inserted = await db
    .from('customers')
    .upsert({ user_id: user.id, stripe_customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (inserted.error) throw inserted.error;

  // Re-read in case a concurrent request won the race.
  const row = await db.from('customers').select('stripe_customer_id').eq('user_id', user.id).single();
  if (row.error) throw row.error;
  return row.data.stripe_customer_id as string;
}
