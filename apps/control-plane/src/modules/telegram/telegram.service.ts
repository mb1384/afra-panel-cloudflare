import { decryptSecret } from '../../core/crypto.js';
import type { Bindings } from '../../core/env.js';
import type { SettingsService } from '../../core/settings.js';

/** توکن ربات از env (ترجیح) یا از تنظیمات رمزنگاری‌شده خوانده می‌شود. */
export async function resolveBotToken(
  env: Bindings,
  settings: SettingsService,
): Promise<string | null> {
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN.length > 20) return env.TELEGRAM_BOT_TOKEN;
  const stored = await settings.getSecretRaw('telegramBotToken');
  if (!stored) return null;
  return decryptSecret(stored, env.AFRA_SECRET_KEY);
}

export async function resolveWebhookSecret(
  env: Bindings,
  settings: SettingsService,
): Promise<string | null> {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  const stored = await settings.getSecretRaw('telegramWebhookSecret');
  if (!stored) return null;
  return decryptSecret(stored, env.AFRA_SECRET_KEY);
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listTelegramAdminIds(env: Bindings): Promise<string[]> {
  const rows = await env.AFRA_DB.prepare('SELECT telegram_id FROM telegram_admins').all<{
    telegram_id: string;
  }>();
  return (rows.results ?? []).map((row) => row.telegram_id);
}

/** ارسال اعلان به همهٔ مدیران مجاز تلگرام. */
export async function broadcastToAdmins(
  env: Bindings,
  settings: SettingsService,
  text: string,
): Promise<number> {
  const config = await settings.load();
  if (!config.telegramEnabled) return 0;
  const token = await resolveBotToken(env, settings);
  if (!token) return 0;
  const ids = await listTelegramAdminIds(env);
  let sent = 0;
  for (const id of ids) {
    if (await sendTelegramMessage(token, id, text)) sent += 1;
  }
  return sent;
}
