export interface Env {
  ASSETS: Fetcher;

  // vars (wrangler.jsonc)
  SITE_URL: string;
  R2_BUCKET: string;
  DOWNLOAD_URL_TTL_SECONDS: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  STRIPE_PRICE_LIFETIME: string;

  // secrets
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
