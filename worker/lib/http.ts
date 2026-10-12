export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error('Unhandled error', err);
  return json({ error: { code: 'internal', message: 'Something went wrong on our side. Try again in a minute.' } }, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', 'bad_request');
  }
}

/** Blocks cross-site form posts against cookie-less JSON endpoints that change state. */
export function assertSameOrigin(request: Request, siteUrl: string): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // non-browser clients
  const allowed = new URL(siteUrl).origin;
  const self = new URL(request.url).origin;
  if (origin !== allowed && origin !== self) {
    throw new HttpError(403, 'Cross-origin request blocked.', 'forbidden');
  }
}
