import { AfraError, telegramAdminSchema, telegramSettingsSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { encryptSecret, timingSafeEqual } from '../../core/crypto.js';
import { newId, nowIso } from '../../core/ids.js';
import { rateLimit, requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { handleTelegramCommand } from './telegram.bot.js';
import type { TelegramUpdate } from './telegram.bot.js';
import { resolveBotToken, resolveWebhookSecret, sendTelegramMessage } from './telegram.service.js';

/* ------------------------------ webhook عمومی ------------------------------ */

export const telegramWebhookRouter = new Hono<AppEnv>();

/**
 * دریافت به‌روزرسانی‌های تلگرام.
 * امنیت: هدر مخفی تلگرام بررسی می‌شود و فقط شناسه‌های موجود در allowlist
 * اجازهٔ اجرای دستور دارند. نرخ درخواست هر فرستنده محدود است.
 */
telegramWebhookRouter.post(
  '/',
  rateLimit({ bucket: 'tg', limit: 30, windowSeconds: 60 }),
  async (c) => {
    const settings = c.get('settings');
    const config = await settings.load();
    if (!config.telegramEnabled) throw new AfraError('TELEGRAM_NOT_CONFIGURED', 404);

    const expectedSecret = await resolveWebhookSecret(c.env, settings);
    const providedSecret = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!expectedSecret || !timingSafeEqual(expectedSecret, providedSecret)) {
      await writeAudit(c.env, {
        action: 'telegram.webhook.rejected',
        resource: 'telegram',
        result: 'failure',
        ip: c.get('clientIp'),
      });
      throw new AfraError('FORBIDDEN', 403);
    }

    const update = (await c.req.json().catch(() => null)) as TelegramUpdate | null;
    const message = update?.message;
    if (!message?.text || !message.from) return jsonOk({ ignored: true });

    const token = await resolveBotToken(c.env, settings);
    if (!token) throw new AfraError('TELEGRAM_NOT_CONFIGURED', 400);

    const telegramId = String(message.from.id);
    const adminRow = await c.env.AFRA_DB.prepare(
      'SELECT telegram_id, role FROM telegram_admins WHERE telegram_id = ?',
    )
      .bind(telegramId)
      .first<{ telegram_id: string; role: string }>();

    if (!adminRow) {
      await sendTelegramMessage(
        token,
        String(message.chat.id),
        'دسترسی شما به این ربات مجاز نیست.',
      );
      await writeAudit(c.env, {
        action: 'telegram.command.denied',
        resource: 'telegram',
        result: 'failure',
        metadata: { telegramId },
      });
      return jsonOk({ denied: true });
    }

    const reply = await handleTelegramCommand(
      c.env,
      settings,
      { telegramId, role: adminRow.role === 'admin' ? 'admin' : 'read_only' },
      message.text,
      c.req.url,
    );

    await sendTelegramMessage(token, String(message.chat.id), reply);
    await writeAudit(c.env, {
      action: 'telegram.command.executed',
      resource: 'telegram',
      metadata: { telegramId, command: message.text.split(/\s+/)[0] },
    });
    return jsonOk({ handled: true });
  },
);

/* ------------------------------ مدیریت تلگرام ------------------------------ */

export const telegramRouter = new Hono<AppEnv>();
telegramRouter.use('*', requireAuth);

telegramRouter.get('/settings', requirePermission('telegram.manage'), async (c) => {
  const settings = c.get('settings');
  const config = await settings.load();
  const token = await resolveBotToken(c.env, settings);
  const secret = await resolveWebhookSecret(c.env, settings);
  return jsonOk({
    enabled: config.telegramEnabled,
    botTokenConfigured: Boolean(token),
    webhookSecretConfigured: Boolean(secret),
    tokenSource: c.env.TELEGRAM_BOT_TOKEN ? 'env' : token ? 'settings' : null,
    notifyEvents: config.telegramNotifyEvents,
    webhookUrl: `${new URL(c.req.url).origin}/api/v1/telegram-webhook`,
  });
});

telegramRouter.put('/settings', requirePermission('telegram.manage'), async (c) => {
  const input = await parseJson(c, telegramSettingsSchema);
  const settings = c.get('settings');

  await settings.set('telegramEnabled', input.enabled);
  if (input.notifyEvents) await settings.set('telegramNotifyEvents', input.notifyEvents);
  if (input.botToken) {
    await settings.set(
      'telegramBotToken',
      await encryptSecret(input.botToken, c.env.AFRA_SECRET_KEY),
      true,
    );
  }
  if (input.webhookSecret) {
    await settings.set(
      'telegramWebhookSecret',
      await encryptSecret(input.webhookSecret, c.env.AFRA_SECRET_KEY),
      true,
    );
  }

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'telegram.settings.updated',
    resource: 'telegram',
    ip: c.get('clientIp'),
    metadata: { enabled: input.enabled, tokenRotated: Boolean(input.botToken) },
  });
  return jsonOk({ saved: true });
});

/** ثبت webhook در تلگرام (عملیات واقعی روی API تلگرام). */
telegramRouter.post('/webhook/register', requirePermission('telegram.manage'), async (c) => {
  const settings = c.get('settings');
  const token = await resolveBotToken(c.env, settings);
  const secret = await resolveWebhookSecret(c.env, settings);
  if (!token || !secret) throw new AfraError('TELEGRAM_NOT_CONFIGURED', 400);

  const webhookUrl = `${new URL(c.req.url).origin}/api/v1/telegram-webhook`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'telegram.webhook.registered',
    resource: 'telegram',
    result: payload.ok ? 'success' : 'failure',
    ip: c.get('clientIp'),
    metadata: { webhookUrl },
  });

  return jsonOk({ registered: payload.ok === true, message: payload.description ?? null, webhookUrl });
});

telegramRouter.get('/admins', requirePermission('telegram.manage'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT id, telegram_id, label, role, created_at FROM telegram_admins ORDER BY created_at',
  ).all<{ id: string; telegram_id: string; label: string | null; role: string; created_at: string }>();
  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      telegramId: row.telegram_id,
      label: row.label,
      role: row.role,
      createdAt: row.created_at,
    })),
  });
});

telegramRouter.post('/admins', requirePermission('telegram.manage'), async (c) => {
  const input = await parseJson(c, telegramAdminSchema);
  const id = newId('tga');
  try {
    await c.env.AFRA_DB.prepare(
      'INSERT INTO telegram_admins (id, telegram_id, label, role, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, input.telegramId, input.label ?? null, input.role, nowIso())
      .run();
  } catch {
    throw new AfraError('DUPLICATE', 409);
  }
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'telegram.admin.added',
    resource: 'telegram_admin',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { role: input.role },
  });
  return jsonOk({ id }, 201);
});

telegramRouter.delete('/admins/:id', requirePermission('telegram.manage'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM telegram_admins WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'telegram.admin.removed',
    resource: 'telegram_admin',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});
