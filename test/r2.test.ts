import { describe, expect, it } from 'vitest';
import { presignR2Get } from '../worker/lib/r2';

const base = {
  accountId: 'acct123',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  bucket: 'blueline-installers',
};

describe('presignR2Get', () => {
  it('signs a private R2 object URL that expires', async () => {
    const url = new URL(
      await presignR2Get({ ...base, key: 'windows/1.0.0/Blueline Setup.exe', expiresInSeconds: 300, downloadFilename: 'Blueline Setup.exe' }),
    );
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/blueline-installers/windows/1.0.0/Blueline%20Setup.exe');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="Blueline Setup.exe"');
  });

  it('clamps the lifetime between 1 minute and 1 hour', async () => {
    const short = new URL(await presignR2Get({ ...base, key: 'a', expiresInSeconds: 5 }));
    const long = new URL(await presignR2Get({ ...base, key: 'a', expiresInSeconds: 999999 }));
    expect(short.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(long.searchParams.get('X-Amz-Expires')).toBe('3600');
  });
});
