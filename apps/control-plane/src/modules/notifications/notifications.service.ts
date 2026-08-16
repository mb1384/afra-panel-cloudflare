import type { Bindings } from '../../core/env.js';
import { newId, nowIso } from '../../core/ids.js';
import type { SettingsService } from '../../core/settings.js';
import { broadcastToAdmins } from '../telegram/telegram.service.js';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationInput {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
}

const SEVERITY_ICON: Record<NotificationSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '⛔️',
};

/**
 * موتور اعلان: ثبت در پنل + ارسال اختیاری به تلگرام بر اساس رویدادهای انتخابی مدیر.
 */
export async function notify(
  env: Bindings,
  settings: SettingsService,
  input: NotificationInput,
): Promise<void> {
  await env.AFRA_DB.prepare(
    'INSERT INTO notifications (id, type, severity, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(newId('ntf'), input.type, input.severity, input.title, input.body, nowIso())
    .run()
    .catch(() => undefined);

  const config = await settings.load();
  if (!config.telegramEnabled) return;
  if (!config.telegramNotifyEvents.includes(input.type)) return;

  const message = `${SEVERITY_ICON[input.severity]} <b>${escapeHtml(input.title)}</b>\n${escapeHtml(input.body)}`;
  await broadcastToAdmins(env, settings, message);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
