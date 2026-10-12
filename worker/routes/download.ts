import type { Env } from '../env';
import { HttpError, json } from '../lib/http';
import { adminClient, requireUser } from '../lib/supabase';
import { presignR2Get } from '../lib/r2';

function ttl(env: Env) {
  return Number(env.DOWNLOAD_URL_TTL_SECONDS) || 300;
}

function sign(env: Env, key: string, filename: string) {
  return presignR2Get({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    key,
    expiresInSeconds: ttl(env),
    downloadFilename: filename,
  });
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}

/** GET /api/releases — newest published build per platform (never exposes storage keys). */
export async function handleReleases(_request: Request, env: Env): Promise<Response> {
  const { data, error } = await adminClient(env)
    .from('releases')
    .select('platform,version,filename,sha256,size_bytes,notes_url,published_at')
    .eq('published', true)
    .order('published_at', { ascending: false });
  if (error) throw error;

  const latest = new Map<string, (typeof data)[number]>();
  for (const r of data ?? []) if (!latest.has(r.platform)) latest.set(r.platform, r);
  return json({ releases: [...latest.values()] }, 200, { 'cache-control': 'public, max-age=60' });
}

/**
 * GET /api/download[?platform=windows]
 * The free Officer Edition download: no account needed. Redirects to a short-lived signed URL
 * for the newest published installer, so the bucket stays private and links can't be hot-linked.
 */
export async function handleDownload(request: Request, env: Env): Promise<Response> {
  const platform = new URL(request.url).searchParams.get('platform') || env.DEFAULT_PLATFORM || 'windows';
  if (!/^[a-z0-9-]{2,32}$/.test(platform)) throw new HttpError(400, 'Unknown platform.', 'bad_request');

  const db = adminClient(env);
  const rel = await db
    .from('releases')
    .select('id,r2_key,filename')
    .eq('published', true)
    .eq('platform', platform)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rel.error) throw rel.error;
  if (!rel.data) return redirect(`${env.SITE_URL.replace(/\/$/, '')}/download-unavailable/`);

  const url = await sign(env, rel.data.r2_key as string, rel.data.filename as string);
  const logged = await db.from('download_events').insert({
    release_id: rel.data.id,
    ip_country: request.headers.get('cf-ipcountry'),
  });
  if (logged.error) console.warn('download log failed', logged.error.message);
  return redirect(url);
}

/**
 * Documents for agency IT and purchasing. Upload them to the bucket at these keys.
 * `public: false` files are only handed to signed-in users (the vendor packet carries your W-9).
 */
export const RESOURCES: Record<string, { key: string; filename: string; public: boolean }> = {
  'security-summary': { key: 'resources/Blueline-Security-CJIS-Summary.pdf', filename: 'Blueline-Security-CJIS-Summary.pdf', public: true },
  'vendor-packet': { key: 'resources/Blueline-Vendor-Packet.zip', filename: 'Blueline-Vendor-Packet.zip', public: false },
};

/**
 * GET /api/resource?name=security-summary  → 302 to a signed URL (public files)
 * GET /api/resource?name=vendor-packet     → JSON { url } for signed-in users
 */
export async function handleResource(request: Request, env: Env): Promise<Response> {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  const res = RESOURCES[name];
  if (!res) throw new HttpError(404, 'No such document.', 'not_found');

  let userId: string | null = null;
  if (!res.public) userId = (await requireUser(request, env)).user.id;

  const exists = await env.FILES.head(res.key);
  if (!exists) throw new HttpError(404, 'This document isn’t available yet. Use the quote form and we’ll email it.', 'not_uploaded');

  const url = await sign(env, res.key, res.filename);
  const logged = await adminClient(env).from('download_events').insert({
    resource: name,
    user_id: userId,
    ip_country: request.headers.get('cf-ipcountry'),
  });
  if (logged.error) console.warn('resource log failed', logged.error.message);

  return res.public ? redirect(url) : json({ url });
}

