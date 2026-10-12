import type { Env } from './env';
import { HttpError, errorResponse, json } from './lib/http';
import { handlePortal } from './routes/portal';
import { handleMe } from './routes/me';
import { handleDownload, handleReleases, handleResource } from './routes/download';
import { handleQuote } from './routes/quote';
import { handleStripeWebhook } from './routes/webhook';

type Handler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Partial<Record<string, Handler>>> = {
  '/api/health': { GET: async () => json({ ok: true }) },
  '/api/download': { GET: handleDownload },
  '/api/releases': { GET: handleReleases },
  '/api/resource': { GET: handleResource },
  '/api/quote': { POST: handleQuote },
  '/api/me': { GET: handleMe },
  '/api/portal': { POST: handlePortal },
  '/api/stripe/webhook': { POST: handleStripeWebhook },
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      const route = routes[path];
      if (!route) throw new HttpError(404, 'Not found.', 'not_found');
      const handler = route[request.method];
      if (!handler) throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
      return await handler(request, env, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
