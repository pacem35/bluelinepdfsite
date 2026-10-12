import type { Env } from '../env';
import { HttpError, assertSameOrigin, json, readJson } from '../lib/http';
import { adminClient } from '../lib/supabase';

interface QuoteBody {
  agency?: string;
  ori?: string;
  seats?: string | number;
  email?: string;
  contacts?: string;
  website?: string; // honeypot: real people never see or fill this field
  turnstileToken?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateQuote(body: QuoteBody) {
  const agency = (body.agency ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const ori = (body.ori ?? '').trim().toUpperCase();
  const contacts = (body.contacts ?? '').trim();
  const seatsRaw = String(body.seats ?? '').trim();
  const seats = seatsRaw === '' ? null : Number(seatsRaw);

  if (agency.length < 2 || agency.length > 200) throw new HttpError(400, 'Enter your agency name.', 'invalid_agency');
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, 'Enter a contact email we can reply to.', 'invalid_email');
  if (ori && !/^[A-Z0-9]{7,9}$/.test(ori)) throw new HttpError(400, 'An ORI is 9 letters and numbers, like MO0140100. Leave it blank if unsure.', 'invalid_ori');
  if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 100000)) {
    throw new HttpError(400, 'Requested seats must be a whole number.', 'invalid_seats');
  }
  if (contacts.length > 4000) throw new HttpError(400, 'Keep the contacts note under 4,000 characters.', 'invalid_contacts');
  return { agency, email, ori: ori || null, seats, contacts: contacts || null };
}

async function passesTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = (await res.json()) as { success?: boolean };
  return out.success === true;
}

/** POST /api/quote — stores the request and pings you. */
export async function handleQuote(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  assertSameOrigin(request, env.SITE_URL);
  const body = await readJson<QuoteBody>(request);

  // Bots that fill the hidden field get a normal-looking success and nothing is stored.
  if (body.website) return json({ ok: true });

  const q = validateQuote(body);
  if (!(await passesTurnstile(env, body.turnstileToken, request.headers.get('cf-connecting-ip')))) {
    throw new HttpError(400, 'The spam check didn’t pass. Reload the page and try again.', 'turnstile_failed');
  }

  const { error } = await adminClient(env).from('quote_requests').insert({
    agency_name: q.agency,
    ori: q.ori,
    seats: q.seats,
    email: q.email,
    contacts: q.contacts,
    ip_country: request.headers.get('cf-ipcountry'),
  });
  if (error) throw error;

  if (env.QUOTE_NOTIFY_URL) {
    const text =
      `New Blueline quote request: ${q.agency}` +
      `${q.ori ? ` (ORI ${q.ori})` : ''}, ${q.seats ?? '?'} seats, ${q.email}` +
      `${q.contacts ? `\n${q.contacts}` : ''}`;
    ctx.waitUntil(
      fetch(env.QUOTE_NOTIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }), // "text" for Slack, "content" for Discord
      }).catch((e) => console.warn('quote notify failed', e)),
    );
  }

  return json({ ok: true });
}
