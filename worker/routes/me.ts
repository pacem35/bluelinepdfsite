import type { Env } from '../env';
import { json } from '../lib/http';
import { requireUser } from '../lib/supabase';
import { hasAccess } from '../lib/entitlement';

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const { user, db } = await requireUser(request, env);
  const [ent, customer] = await Promise.all([
    db
      .from('entitlements')
      .select('plan,status,current_period_end,cancel_at_period_end')
      .eq('user_id', user.id)
      .maybeSingle(),
    db.from('customers').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  if (ent.error) throw ent.error;
  if (customer.error) throw customer.error;

  return json({
    email: user.email,
    hasAccess: hasAccess(ent.data),
    hasBillingAccount: Boolean(customer.data),
    license: ent.data ?? null,
  });
}
