import { daysUntil, formatBytes, usagePercent } from '@afra/shared';
import type { Bindings } from './core/env.js';
import { isoPlusDays, newId, nowIso } from './core/ids.js';
import { Logger } from './core/logger.js';
import { SettingsService } from './core/settings.js';
import { checkBackends, checkDnsServers, runHealthChecks } from './modules/health/health.service.js';
import { notify } from './modules/notifications/notifications.service.js';
import { createBackupPayload, storeBackup } from './modules/backup/backup.service.js';

/** بررسی سلامت دوره‌ای (هر ۵ دقیقه). */
export async function cronHealth(env: Bindings, logger: Logger): Promise<void> {
  const settings = new SettingsService(env);
  const result = await runHealthChecks(env, settings);
  logger.info('health cron finished', { result: 'skipped' in result ? result : { checked: result.checked } });
}

/** نگهداشت ساعتی: انقضا، هشدار حجم، بازنشانی سهمیهٔ روزانه. */
export async function cronHourly(env: Bindings, logger: Logger): Promise<void> {
  const settings = new SettingsService(env);
  const config = await settings.load();
  const now = nowIso();

  // ۱) بازنشانی مصرف روزانه
  const dailyReset = await env.AFRA_DB.prepare(
    'UPDATE users SET daily_used_bytes = 0, daily_reset_at = ? WHERE daily_reset_at IS NULL OR daily_reset_at <= ?',
  )
    .bind(isoPlusDays(1), now)
    .run();

  // ۲) کاربران منقضی‌شده
  const expired = await env.AFRA_DB.prepare(
    `SELECT id, name, username, credential_uuid FROM users
      WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(now)
    .all<{ id: string; name: string; username: string; credential_uuid: string }>();

  for (const user of expired.results ?? []) {
    await env.AFRA_DB.prepare('UPDATE users SET enabled = 0, updated_at = ? WHERE id = ?')
      .bind(now, user.id)
      .run();
    await env.AFRA_KV.delete(`edge:user:${user.credential_uuid.toLowerCase()}`).catch(() => undefined);
    if (config.revokeOnExpire) {
      await env.AFRA_DB.prepare('UPDATE subscriptions SET revoked_at = ? WHERE user_id = ?')
        .bind(now, user.id)
        .run();
    }
    await notify(env, settings, {
      type: 'user.expired',
      severity: 'warning',
      title: `اشتراک «${user.name}» منقضی شد`,
      body: `کاربر ${user.username} به‌صورت خودکار غیرفعال شد.`,
    });
  }

  // ۳) هشدار نزدیک شدن به سقف حجم
  const nearQuota = await env.AFRA_DB.prepare(
    `SELECT id, name, username, used_bytes, quota_bytes FROM users
      WHERE enabled = 1 AND quota_bytes IS NOT NULL
        AND used_bytes >= (quota_bytes * ? / 100) AND used_bytes < quota_bytes`,
  )
    .bind(config.quotaWarningPercent)
    .all<{ id: string; name: string; username: string; used_bytes: number; quota_bytes: number }>();

  for (const user of nearQuota.results ?? []) {
    const percent = usagePercent(user.quota_bytes, user.used_bytes);
    await notify(env, settings, {
      type: 'quota.warning',
      severity: 'warning',
      title: `حجم «${user.name}» در حال اتمام است`,
      body: `${percent}٪ از ${formatBytes(user.quota_bytes)} مصرف شده است.`,
    });
  }

  // ۴) هشدار نزدیک شدن به انقضا
  const soonExpiring = await env.AFRA_DB.prepare(
    `SELECT id, name, username, expires_at FROM users
      WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`,
  )
    .bind(now, isoPlusDays(config.expiryWarningDays))
    .all<{ id: string; name: string; username: string; expires_at: string }>();

  for (const user of soonExpiring.results ?? []) {
    const remaining = daysUntil(user.expires_at);
    await notify(env, settings, {
      type: 'user.expiring',
      severity: 'info',
      title: `اشتراک «${user.name}» رو به پایان است`,
      body: `${remaining ?? '?'} روز تا انقضا باقی است.`,
    });
  }

  // ۵) بررسی سلامت DNS و بک‌اندها
  await checkDnsServers(env, config.healthCheckTimeoutMs).catch(() => 0);
  await checkBackends(env, config.healthCheckTimeoutMs).catch(() => 0);

  logger.info('hourly cron finished', {
    dailyReset: dailyReset.meta.changes ?? 0,
    expired: (expired.results ?? []).length,
    quotaWarnings: (nearQuota.results ?? []).length,
    expiringSoon: (soonExpiring.results ?? []).length,
  });
}

/** نگهداشت روزانه: پاک‌سازی داده‌های قدیمی و پشتیبان خودکار. */
export async function cronDaily(env: Bindings, logger: Logger): Promise<void> {
  const settings = new SettingsService(env);
  const config = await settings.load();
  const cutoff = new Date(Date.now() - config.logRetentionDays * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  const cleanup = await env.AFRA_DB.batch([
    env.AFRA_DB.prepare('DELETE FROM app_logs WHERE created_at < ?').bind(cutoff),
    env.AFRA_DB.prepare('DELETE FROM node_health_checks WHERE checked_at < ?').bind(cutoff),
    env.AFRA_DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(cutoff),
    env.AFRA_DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
    env.AFRA_DB.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').bind(
      cutoff,
    ),
    env.AFRA_DB.prepare('DELETE FROM traffic_samples WHERE bucket_at < ?').bind(
      new Date(Date.now() - 90 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ),
  ]);

  let backupKey: string | null = null;
  const autoBackup = await settings.getRaw<boolean>('autoBackupEnabled', false);
  if (autoBackup && env.AFRA_BACKUPS) {
    try {
      const payload = await createBackupPayload(env, false);
      const stored = await storeBackup(env, payload, { encrypt: false, createdBy: 'cron' });
      backupKey = stored.key;
    } catch (error) {
      await logger.persist('WARN', 'auto backup failed', { error: String(error) });
    }
  }

  logger.info('daily cron finished', {
    statements: cleanup.length,
    backupKey: backupKey ? 'created' : 'skipped',
  });
}

export async function handleScheduled(
  controller: ScheduledController,
  env: Bindings,
): Promise<void> {
  const settings = new SettingsService(env);
  const config = await settings.load().catch(() => null);
  const logger = new Logger(env, config?.logLevel ?? 'INFO', newId('cron'));

  try {
    switch (controller.cron) {
      case '0 * * * *':
        await cronHourly(env, logger);
        break;
      case '30 3 * * *':
        await cronDaily(env, logger);
        break;
      default:
        await cronHealth(env, logger);
        break;
    }
  } catch (error) {
    await logger.persist('ERROR', 'cron failed', { cron: controller.cron, error: String(error) });
  }
}
