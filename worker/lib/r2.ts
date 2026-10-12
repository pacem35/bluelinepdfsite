import { AwsClient } from 'aws4fetch';

export interface PresignInput {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
  downloadFilename?: string;
}

/**
 * Returns a time-limited GET URL for a private R2 object using R2's S3-compatible API
 * (SigV4 query-string signing). The bucket itself stays private.
 */
export async function presignR2Get(input: PresignInput): Promise<string> {
  const ttl = Math.min(Math.max(Math.floor(input.expiresInSeconds), 60), 3600);
  const client = new AwsClient({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const encodedKey = input.key.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`https://${input.accountId}.r2.cloudflarestorage.com/${input.bucket}/${encodedKey}`);
  url.searchParams.set('X-Amz-Expires', String(ttl));
  if (input.downloadFilename) {
    const safe = input.downloadFilename.replace(/["\\\r\n]/g, '');
    url.searchParams.set('response-content-disposition', `attachment; filename="${safe}"`);
  }

  const signed = await client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}
