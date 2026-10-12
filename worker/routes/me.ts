import type { Env } from '../env';
import { json } from '../lib/http';
import { agencyIdsFor, requireUser } from '../lib/supabase';
import { isLicenseActive, type LicenseRow } from '../lib/licenses';

/** GET /api/me — the signed-in person's agencies and their licenses. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const { user, db } = await requireUser(request, env);
  const ids = await agencyIdsFor(db, user.email);
  if (ids.length === 0) return json({ email: user.email, agencies: [] });

  const [agencies, licenses] = await Promise.all([
    db.from('agencies').select('id,name,ori,stripe_customer_id').in('id', ids).order('name'),
    db.from('licenses').select('*').in('agency_id', ids).order('created_at', { ascending: false }),
  ]);
  if (agencies.error) throw agencies.error;
  if (licenses.error) throw licenses.error;

  const now = new Date();
  return json({
    email: user.email,
    agencies: (agencies.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      ori: a.ori,
      hasBilling: Boolean(a.stripe_customer_id),
      licenses: ((licenses.data ?? []) as LicenseRow[])
        .filter((l) => l.agency_id === a.id)
        .map((l) => ({
          key: l.license_key,
          plan: l.plan,
          kind: l.kind,
          seats: l.seats,
          status: l.status,
          active: isLicenseActive(l, now),
          renewsAt: l.kind === 'subscription' ? l.current_period_end : null,
          expiresAt: l.kind === 'term' || l.kind === 'pilot' ? l.expires_at : null,
          cancelAtPeriodEnd: l.cancel_at_period_end,
          maintenanceUntil: l.maintenance_until,
        })),
    })),
  });
}
