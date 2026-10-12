export type Plan = 'standard' | 'bundle' | 'pro';
export type LicenseKind = 'subscription' | 'term' | 'perpetual' | 'pilot';
/** What a Stripe Price sells, taken from its lookup key, e.g. "pro_annual". */
export type PriceKind = 'annual' | 'perpetual' | 'maintenance';

export const BUNDLE_SEATS = 10;
const PLANS: Plan[] = ['standard', 'bundle', 'pro'];
const PRICE_KINDS: PriceKind[] = ['annual', 'perpetual', 'maintenance'];

/**
 * Stripe Prices are identified by lookup key: `<plan>_<kind>`, for example
 * `standard_annual`, `bundle_perpetual`, `pro_maintenance`. Anything else is ignored.
 */
export function parseLookupKey(key: string | null | undefined): { plan: Plan; kind: PriceKind } | null {
  const m = /^(standard|bundle|pro)_(annual|perpetual|maintenance)$/.exec(key ?? '');
  if (!m) return null;
  const plan = m[1] as Plan;
  const kind = m[2] as PriceKind;
  return PLANS.includes(plan) && PRICE_KINDS.includes(kind) ? { plan, kind } : null;
}

export function seatsFor(plan: Plan, quantity: number | null | undefined): number {
  const q = Math.max(1, Math.floor(quantity ?? 1));
  return plan === 'bundle' ? BUNDLE_SEATS * q : q;
}

export interface LicenseRow {
  id: string;
  agency_id: string;
  license_key: string;
  plan: Plan;
  kind: LicenseKind;
  seats: number;
  status: string;
  stripe_subscription_id: string | null;
  stripe_invoice_line_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  maintenance_until: string | null;
  expires_at: string | null;
}

/** Stripe statuses that keep an annual subscription usable. past_due covers late Net 30 payments. */
const LIVE_SUBSCRIPTION = new Set(['active', 'trialing', 'past_due']);

export function isLicenseActive(
  l: Pick<LicenseRow, 'kind' | 'status' | 'expires_at'>,
  now: Date = new Date(),
): boolean {
  switch (l.kind) {
    case 'subscription':
      return LIVE_SUBSCRIPTION.has(l.status);
    case 'perpetual':
      return l.status === 'active';
    case 'term':
    case 'pilot':
      return l.status === 'active' && !!l.expires_at && new Date(l.expires_at) > now;
    default:
      return false;
  }
}

/** Adds one year to whichever is later: the current date on the license or the payment date. */
export function extendOneYear(current: string | null, from: Date): string {
  const base = current && new Date(current) > from ? new Date(current) : new Date(from);
  base.setUTCFullYear(base.getUTCFullYear() + 1);
  return base.toISOString();
}

/** Human-friendly key, e.g. BL-7KQ2-M9XD-P4TA-3HCV (no 0/O/1/I). */
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `BL-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}
