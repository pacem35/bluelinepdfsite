import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Env } from '../env';
import { HttpError } from './http';

/** Service-role client. Bypasses RLS — only ever used inside the Worker. */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Validates the caller's Supabase access token (Authorization: Bearer …) and returns the user.
 * Agency access is granted by email, so the email must be confirmed.
 */
export async function requireUser(request: Request, env: Env): Promise<{ user: User & { email: string }; db: SupabaseClient }> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sign in to continue.', 'unauthenticated');

  const db = adminClient(env);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Sign in again.', 'unauthenticated');
  if (!data.user.email || !data.user.email_confirmed_at) {
    throw new HttpError(403, 'Confirm your email address first, using the link we sent you.', 'email_unconfirmed');
  }
  return { user: data.user as User & { email: string }, db };
}

/** Agencies the signed-in user belongs to (by verified email). */
export async function agencyIdsFor(db: SupabaseClient, email: string): Promise<string[]> {
  const { data, error } = await db.from('agency_members').select('agency_id').eq('email', email.toLowerCase());
  if (error) throw error;
  return (data ?? []).map((r) => r.agency_id as string);
}
