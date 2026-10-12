export interface EntitlementRow {
  user_id: string;
  plan: 'monthly' | 'yearly' | 'lifetime' | null;
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** Stripe statuses that keep access open. past_due gets access during Stripe's retry window. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function hasAccess(row: Pick<EntitlementRow, 'plan' | 'status'> | null | undefined): boolean {
  if (!row) return false;
  if (row.plan === 'lifetime') return row.status === 'active';
  return ACTIVE_STATUSES.has(row.status);
}
