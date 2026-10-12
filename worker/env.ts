export interface Env {
  ASSETS: Fetcher;
  /** Same private bucket, bound directly so the Worker can check a file exists before signing a link. */
  FILES: R2Bucket;

  // vars (wrangler.jsonc)
  SITE_URL: string;
  R2_BUCKET: string;
  DOWNLOAD_URL_TTL_SECONDS: string;
  /** Platform the "Download free" buttons point at. */
  DEFAULT_PLATFORM: string;

  // secrets
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  // optional secrets
  /** Slack/Discord/ntfy webhook URL that gets a message for every quote request. */
  QUOTE_NOTIFY_URL?: string;
  /** Cloudflare Turnstile secret. When set, the quote form must pass a Turnstile check. */
  TURNSTILE_SECRET_KEY?: string;
}
