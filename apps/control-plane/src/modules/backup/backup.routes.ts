import { AfraError, backupCreateSchema, backupRestoreSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { safeJson } from '../../db/mappers.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { createBackupPayload, loadBackup, restoreBackup, storeBackup } from './backup.service.js';

export const backupRouter = new Hono<AppEnv>();
backupRouter.use('*', requireAuth);

backupRouter.get('/', requirePermission('backup.manage'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT id, r2_key, size_bytes, encrypted, has_secrets, table_counts, created_by, created_at FROM backups ORDER BY created_at DESC LIMIT 100',
  ).all<{
    id: string;
    r2_key: string;
    size_bytes: number;
    encrypted: number;
    has_secrets: number;
    table_counts: string | null;
    created_by: string | null;
    created_at: string;
  }>();

  return jsonOk({
    storageConfigured: Boolean(c.env.AFRA_BACKUPS),
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      key: row.r2_key,
      sizeBytes: row.size_bytes,
      encrypted: row.encrypted === 1,
      hasSecrets: row.has_secrets === 1,
      tableCounts: safeJson<Record<string, number>>(row.table_counts, {}),
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
  });
});

backupRouter.post('/', requirePermission('backup.manage'), async (c) => {
  const input = await parseJson(c, backupCreateSchema);
  const auth = c.get('auth');

  if (input.includeSecrets && auth?.role !== 'super_admin') {
    throw new AfraError('FORBIDDEN', 403, undefined, 'فقط مدیر ارشد می‌تواند اسرار را در پشتیبان بگنجاند.');
  }

  const payload = await createBackupPayload(c.env, input.includeSecrets);
  const stored = await storeBackup(c.env, payload, {
    encrypt: input.encrypt,
    passphrase: input.passphrase,
    createdBy: auth?.username ?? null,
  });

  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'backup.created',
    resource: 'backup',
    resourceId: stored.id,
    ip: c.get('clientIp'),
    metadata: {
      encrypted: stored.encrypted,
      includeSecrets: input.includeSecrets,
      sizeBytes: stored.sizeBytes,
    },
  });

  return jsonOk({ backup: stored }, 201);
});

/** دانلود پشتیبان از R2 (فقط با مجوز backup.manage). */
backupRouter.get('/:id/download', requirePermission('backup.manage'), async (c) => {
  if (!c.env.AFRA_BACKUPS) throw new AfraError('BACKUP_NOT_CONFIGURED', 400);
  const id = requireParam(c, 'id');
  const row = await c.env.AFRA_DB.prepare('SELECT r2_key FROM backups WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) throw new AfraError('BACKUP_NOT_FOUND', 404);

  const object = await c.env.AFRA_BACKUPS.get(row.r2_key);
  if (!object) throw new AfraError('BACKUP_NOT_FOUND', 404);

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'backup.downloaded',
    resource: 'backup',
    resourceId: id,
    ip: c.get('clientIp'),
  });

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${row.r2_key.split('/').pop() ?? 'afra-backup'}"`,
      'cache-control': 'no-store',
    },
  });
});

backupRouter.post('/restore', requirePermission('backup.manage'), async (c) => {
  const input = await parseJson(c, backupRestoreSchema);
  const auth = c.get('auth');
  if (auth?.role !== 'super_admin') {
    throw new AfraError('FORBIDDEN', 403, undefined, 'بازگردانی فقط توسط مدیر ارشد مجاز است.');
  }

  const payload = await loadBackup(c.env, input.key, input.passphrase);
  const report = await restoreBackup(c.env, payload, { wipeExisting: input.wipeExisting });
  await c.get('settings').invalidate();

  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'backup.restored',
    resource: 'backup',
    ip: c.get('clientIp'),
    metadata: { key: input.key, wipeExisting: input.wipeExisting, restored: report.restored },
  });

  return jsonOk({ report, backupCreatedAt: payload.meta.createdAt });
});

backupRouter.delete('/:id', requirePermission('backup.manage'), async (c) => {
  const id = requireParam(c, 'id');
  const row = await c.env.AFRA_DB.prepare('SELECT r2_key FROM backups WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) throw new AfraError('BACKUP_NOT_FOUND', 404);

  if (c.env.AFRA_BACKUPS) await c.env.AFRA_BACKUPS.delete(row.r2_key);
  await c.env.AFRA_DB.prepare('DELETE FROM backups WHERE id = ?').bind(id).run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'backup.deleted',
    resource: 'backup',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});
