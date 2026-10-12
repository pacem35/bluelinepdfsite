import type { Env } from '../env';
import { HttpError, json } from '../lib/http';
import { adminClient, requireUser } from '../lib/supabase';
import { hasAccess } from '../lib/entitlement';
import { presignR2Get } from '../lib/r2';

interface ReleaseRow {
  id: string;
  platform: string;
  version: string;
  r2_key: string;
  filename: string;
  sha256: string | null;
  size_bytes: number | null;
  notes_url: string | null;
  published_at: string;
}

/** GET /api/releases — newest published build per platform. Public: lists versions, never file locations. */
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

/** GET /api/download?platform=windows — licensed users get a short-lived signed URL to the installer. */
export async function handleDownload(request: Request, env: Env): Promise<Response> {
  const { user, db } = await requireUser(request, env);
  const platform = new URL(request.url).searchParams.get('platform') ?? '';
  if (!/^[a-z0-9-]{2,32}$/.test(platform)) throw new HttpError(400, 'Choose a platform.', 'bad_request');

  const ent = await db.from('entitlements').select('plan,status').eq('user_id', user.id).maybeSingle();
  if (ent.error) throw ent.error;
  if (!hasAccess(ent.data)) {
    throw new HttpError(402, 'Downloads unlock once you have an active license.', 'license_required');
  }

  const rel = await db
    .from('releases')
    .select('id,platform,version,r2_key,filename,sha256,size_bytes,notes_url,published_at')
    .eq('published', true)
    .eq('platform', platform)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle<ReleaseRow>();
  if (rel.error) throw rel.error;
  if (!rel.data) throw new HttpError(404, `No ${platform} build is published yet.`, 'no_release');

  const ttl = Number(env.DOWNLOAD_URL_TTL_SECONDS) || 300;
  const url = await presignR2Get({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    key: rel.data.r2_key,
    expiresInSeconds: ttl,
    downloadFilename: rel.data.filename,
  });

  const logged = await db.from('download_events').insert({
    user_id: user.id,
    release_id: rel.data.id,
    ip_country: request.headers.get('cf-ipcountry'),
  });
  if (logged.error) console.warn('download log failed', logged.error.message);

  return json({
    url,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    version: rel.data.version,
    filename: rel.data.filename,
    sha256: rel.data.sha256,
  });
}
