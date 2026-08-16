import { formatBytes, parseSize, toPersianDigits } from '@afra/shared';
import { writeAudit } from '../../core/audit.js';
import type { Bindings } from '../../core/env.js';
import type { SettingsService } from '../../core/settings.js';
import { buildSubscriptionUrls } from '../subscriptions/subscriptions.service.js';
import {
  createUser,
  extendUser,
  getUserById,
  listUsers,
  setEnabled,
  updateUser,
  userStateOf,
} from '../users/users.service.js';
import { escapeHtml } from '../notifications/notifications.service.js';
import { HEALTH_LABELS_FA } from '../health/health.service.js';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

export interface TelegramAdminRecord {
  telegramId: string;
  role: 'admin' | 'read_only';
}

const HELP_TEXT = [
  '<b>راهنمای ربات پنل افرا</b>',
  '',
  '/help — نمایش همین راهنما',
  '/health — وضعیت سلامت سرورها',
  '/users — فهرست آخرین کاربران',
  '/user &lt;نام‌کاربری&gt; — جزئیات کاربر',
  '/usage &lt;نام‌کاربری&gt; — مصرف کاربر',
  '/sub &lt;نام‌کاربری&gt; — لینک اشتراک',
  '/adduser &lt;نام‌کاربری&gt; &lt;روز&gt; &lt;حجم&gt; — ایجاد کاربر (مثال: /adduser ali 30 50GB)',
  '/extend &lt;نام‌کاربری&gt; &lt;روز&gt; — تمدید',
  '/quota &lt;نام‌کاربری&gt; &lt;حجم&gt; — تغییر حجم',
  '/enable &lt;نام‌کاربری&gt; — فعال‌سازی',
  '/disable &lt;نام‌کاربری&gt; — غیرفعال‌سازی',
  '',
  'دستورهای تغییردهنده فقط برای مدیران با نقش «admin» فعال است.',
].join('\n');

const STATE_LABELS: Record<string, string> = {
  active: 'فعال',
  disabled: 'غیرفعال',
  expired: 'منقضی‌شده',
  exhausted: 'حجم تمام‌شده',
};

async function findUserByUsername(
  env: Bindings,
  username: string,
): Promise<string | null> {
  const row = await env.AFRA_DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * پردازش دستور تلگرام. خروجی متن پاسخ فارسی است.
 * هیچ دستوری بدون حضور فرستنده در allowlist اجرا نمی‌شود.
 */
export async function handleTelegramCommand(
  env: Bindings,
  settings: SettingsService,
  admin: TelegramAdminRecord,
  text: string,
  requestUrl: string,
): Promise<string> {
  const parts = text.trim().split(/\s+/);
  const command = (parts[0] ?? '').toLowerCase().replace(/@.*$/, '');
  const args = parts.slice(1);
  const canWrite = admin.role === 'admin';
  const config = await settings.load();

  const requireWrite = (): string | null =>
    canWrite ? null : '⛔️ شما فقط دسترسی خواندن دارید.';

  switch (command) {
    case '/start':
    case '/help':
      return HELP_TEXT;

    case '/health': {
      const rows = await env.AFRA_DB.prepare(
        'SELECT name, health, latency_ms FROM nodes WHERE enabled = 1 ORDER BY priority LIMIT 30',
      ).all<{ name: string; health: string; latency_ms: number | null }>();
      const items = rows.results ?? [];
      if (items.length === 0) return 'هیچ سرور فعالی ثبت نشده است.';
      const lines = items.map((row) => {
        const icon = row.health === 'healthy' ? '🟢' : row.health === 'degraded' ? '🟡' : '🔴';
        const latency = row.latency_ms === null ? '—' : `${toPersianDigits(row.latency_ms)}ms`;
        return `${icon} ${escapeHtml(row.name)} — ${HEALTH_LABELS_FA[row.health as keyof typeof HEALTH_LABELS_FA] ?? row.health} (${latency})`;
      });
      return `<b>وضعیت سرورها</b>\n${lines.join('\n')}`;
    }

    case '/users': {
      const { items, total } = await listUsers(env, {
        page: 1,
        pageSize: 10,
        order: 'desc',
        state: 'all',
      });
      if (items.length === 0) return 'هنوز کاربری ایجاد نشده است.';
      const lines = items.map(
        (user) =>
          `• ${escapeHtml(user.username)} — ${STATE_LABELS[userStateOf(user)]} — ${formatBytes(user.usedBytes)} / ${formatBytes(user.quotaBytes)}`,
      );
      return `<b>کاربران (${toPersianDigits(total)} کل)</b>\n${lines.join('\n')}`;
    }

    case '/user':
    case '/usage': {
      if (args.length === 0) return 'نام کاربری را وارد کنید. مثال: /user ali';
      const id = await findUserByUsername(env, args[0]);
      if (!id) return 'کاربر یافت نشد.';
      const user = await getUserById(env, id);
      if (!user) return 'کاربر یافت نشد.';
      return [
        `<b>${escapeHtml(user.name)}</b> (${escapeHtml(user.username)})`,
        `وضعیت: ${STATE_LABELS[userStateOf(user)]}`,
        `مصرف: ${formatBytes(user.usedBytes)} از ${formatBytes(user.quotaBytes)}`,
        `انقضا: ${user.expiresAt ? user.expiresAt.slice(0, 10) : 'نامحدود'}`,
        `آخرین فعالیت: ${user.lastActivityAt ? user.lastActivityAt.slice(0, 16).replace('T', ' ') : '—'}`,
      ].join('\n');
    }

    case '/sub': {
      if (args.length === 0) return 'نام کاربری را وارد کنید. مثال: /sub ali';
      const id = await findUserByUsername(env, args[0]);
      if (!id) return 'کاربر یافت نشد.';
      const row = await env.AFRA_DB.prepare('SELECT token FROM subscriptions WHERE user_id = ?')
        .bind(id)
        .first<{ token: string }>();
      if (!row) return 'اشتراکی برای این کاربر ثبت نشده است.';
      const urls = buildSubscriptionUrls(row.token, config.edgeUrl, requestUrl);
      return `<b>لینک اشتراک</b>\n<code>${escapeHtml(urls.subscriptionUrl)}</code>\n\n⚠️ این لینک یک اعتبارنامه است؛ آن را عمومی نکنید.`;
    }

    case '/adduser': {
      const denied = requireWrite();
      if (denied) return denied;
      if (args.length < 1) return 'قالب صحیح: /adduser &lt;نام‌کاربری&gt; &lt;روز&gt; &lt;حجم&gt;';
      const username = args[0];
      const days = Number(args[1] ?? '30');
      const quota = args[2] ?? null;
      if (await findUserByUsername(env, username)) return 'این نام کاربری قبلاً استفاده شده است.';

      const { user, subscriptionToken } = await createUser(env, {
        name: username,
        username,
        enabled: true,
        tags: ['telegram'],
        nodeIds: [],
        subscriptionFormat: 'auto',
        expiresInDays: Number.isFinite(days) && days > 0 ? days : 30,
        quota: quota && parseSize(quota) ? quota : null,
      });
      const urls = buildSubscriptionUrls(subscriptionToken, config.edgeUrl, requestUrl);
      await writeAudit(env, {
        action: 'user.created',
        resource: 'user',
        resourceId: user.id,
        metadata: { via: 'telegram', telegramId: admin.telegramId },
      });
      return [
        `✅ کاربر <b>${escapeHtml(username)}</b> ایجاد شد.`,
        `حجم: ${formatBytes(user.quotaBytes)}`,
        `انقضا: ${user.expiresAt ? user.expiresAt.slice(0, 10) : 'نامحدود'}`,
        '',
        `<code>${escapeHtml(urls.subscriptionUrl)}</code>`,
      ].join('\n');
    }

    case '/extend': {
      const denied = requireWrite();
      if (denied) return denied;
      if (args.length < 2) return 'قالب صحیح: /extend &lt;نام‌کاربری&gt; &lt;روز&gt;';
      const id = await findUserByUsername(env, args[0]);
      if (!id) return 'کاربر یافت نشد.';
      const days = Number(args[1]);
      if (!Number.isFinite(days) || days <= 0) return 'تعداد روز نامعتبر است.';
      const expiresAt = await extendUser(env, id, days);
      await writeAudit(env, {
        action: 'user.extended',
        resource: 'user',
        resourceId: id,
        metadata: { via: 'telegram', days },
      });
      return `✅ تمدید شد تا ${expiresAt?.slice(0, 10) ?? '—'}`;
    }

    case '/quota': {
      const denied = requireWrite();
      if (denied) return denied;
      if (args.length < 2) return 'قالب صحیح: /quota &lt;نام‌کاربری&gt; &lt;حجم&gt;';
      const id = await findUserByUsername(env, args[0]);
      if (!id) return 'کاربر یافت نشد.';
      const bytes = parseSize(args[1]);
      await updateUser(env, id, { quota: args[1] });
      await writeAudit(env, {
        action: 'user.updated',
        resource: 'user',
        resourceId: id,
        metadata: { via: 'telegram', quota: args[1] },
      });
      return `✅ حجم به ${formatBytes(bytes)} تغییر یافت.`;
    }

    case '/enable':
    case '/disable': {
      const denied = requireWrite();
      if (denied) return denied;
      if (args.length === 0) return 'نام کاربری را وارد کنید.';
      const id = await findUserByUsername(env, args[0]);
      if (!id) return 'کاربر یافت نشد.';
      const enable = command === '/enable';
      await setEnabled(env, id, enable);
      await writeAudit(env, {
        action: enable ? 'user.enabled' : 'user.disabled',
        resource: 'user',
        resourceId: id,
        metadata: { via: 'telegram' },
      });
      return enable ? '✅ کاربر فعال شد.' : '✅ کاربر غیرفعال شد.';
    }

    default:
      return 'دستور شناخته نشد. برای راهنما /help را بفرستید.';
  }
}
