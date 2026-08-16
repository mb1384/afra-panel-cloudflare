/** Bindings و متغیرهای محیطی ورکر Control Plane. */
export interface Bindings {
  AFRA_DB: D1Database;
  AFRA_KV: KVNamespace;
  AFRA_BACKUPS?: R2Bucket;
  ASSETS?: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
  HEALTH_COORDINATOR: DurableObjectNamespace;
  /** صف اختیاری؛ در صورت نبود، پردازش هم‌زمان انجام می‌شود. */
  AFRA_QUEUE?: Queue<unknown>;

  AFRA_ENV: string;
  AFRA_VERSION: string;

  /** اسرار (wrangler secret put) */
  AFRA_SECRET_KEY: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  AFRA_PANEL_URL?: string;
  AFRA_EDGE_URL?: string;
}

export function requireSecretKey(env: Bindings): string {
  const key = env.AFRA_SECRET_KEY;
  if (!key || key.length < 24) {
    throw new Error(
      'AFRA_SECRET_KEY تنظیم نشده است. با دستور `wrangler secret put AFRA_SECRET_KEY` مقدار آن را تعیین کنید.',
    );
  }
  return key;
}
