import type { Bindings } from './env.js';
import { newId, nowIso } from './ids.js';
import { redact } from './logger.js';

export interface AuditInput {
  adminId?: string | null;
  adminUsername?: string | null;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  result?: 'success' | 'failure';
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * ثبت رویداد مدیریتی. متادیتا قبل از ذخیره پاک‌سازی می‌شود تا هیچ
 * اعتبارنامه‌ای (گذرواژه، توکن، UUID) در گزارش باقی نماند.
 */
export async function writeAudit(env: Bindings, input: AuditInput): Promise<void> {
  try {
    await env.AFRA_DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, admin_username, action, resource, resource_id, result, ip, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('aud'),
        input.adminId ?? null,
        input.adminUsername ?? null,
        input.action,
        input.resource ?? null,
        input.resourceId ?? null,
        input.result ?? 'success',
        input.ip ?? null,
        input.metadata ? JSON.stringify(redact(input.metadata)).slice(0, 4000) : null,
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error(JSON.stringify({ level: 'ERROR', message: 'audit write failed', error: String(error) }));
  }
}
