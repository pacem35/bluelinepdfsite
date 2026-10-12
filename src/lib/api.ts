import { getSession } from './supabase';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getSession();
  const headers = new Headers(init.headers);
  if (session) headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.body) headers.set('content-type', 'application/json');

  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } }).error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

export async function startCheckout(plan: string): Promise<void> {
  const { url } = await api<{ url: string }>('/api/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
  window.location.assign(url);
}
