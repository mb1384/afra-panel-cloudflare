import { AfraError } from '@afra/shared';
import { decryptSecret } from '../core/crypto.js';
import type { Bindings } from '../core/env.js';
import type { SettingsService } from '../core/settings.js';
import { CloudflareClient } from './client.js';

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
  source: 'env' | 'settings';
}

/**
 * اعتبارنامهٔ Cloudflare: ابتدا از متغیرهای محیطی (روش توصیه‌شده) و
 * سپس از تنظیمات رمزنگاری‌شده در دیتابیس خوانده می‌شود.
 * مقدار توکن هرگز به پاسخ API یا لاگ نمی‌رود.
 */
export async function resolveCloudflareCredentials(
  env: Bindings,
  settings: SettingsService,
): Promise<CloudflareCredentials | null> {
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    return {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      source: 'env',
    };
  }

  const accountId = await settings.getRaw<string>('cloudflareAccountId', '');
  const encrypted = await settings.getSecretRaw('cloudflareApiToken');
  if (!accountId || !encrypted) return null;

  const apiToken = await decryptSecret(encrypted, env.AFRA_SECRET_KEY);
  if (!apiToken) return null;
  return { accountId, apiToken, source: 'settings' };
}

export async function requireCloudflareClient(
  env: Bindings,
  settings: SettingsService,
): Promise<{ client: CloudflareClient; credentials: CloudflareCredentials }> {
  const credentials = await resolveCloudflareCredentials(env, settings);
  if (!credentials) throw new AfraError('CLOUDFLARE_NOT_CONFIGURED', 400);
  return {
    client: new CloudflareClient(credentials.accountId, credentials.apiToken),
    credentials,
  };
}
