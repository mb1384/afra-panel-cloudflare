import { AfraError, ALL_PERMISSION_KEYS, PERMISSIONS, ROLE_LABELS_FA, adminCreateSchema, settingsUpdateSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { hashPassword } from '../../core/crypto.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { revokeAllSessions } from '../../core/session.js';

export const settingsRouter = new Hono<AppEnv>();
settingsRouter.use('*', requireAuth);

settingsRouter.get('/', requirePermission('settings.read'), async (c) => {
  const settings = await c.get('settings').publicSettings();
  return jsonOk({
    settings,
    environment: c.env.AFRA_ENV,
    version: c.env.AFRA_VERSION,
    capabilities: {
      r2Backups: Boolean(c.env.AFRA_BACKUPS),
      queues: Boolean(c.env.AFRA_QUEUE),
      staticAssets: Boolean(c.env.ASSETS),
      cloudflareEnv: Boolean(c.env.CLOUDFLARE_ACCOUNT_ID && c.env.CLOUDFLARE_API_TOKEN),
      telegramEnv: Boolean(c.env.TELEGRAM_BOT_TOKEN),
    },
  });
});

settingsRouter.patch('/', requirePermission('settings.write'), async (c) => {
  const input = await parseJson(c, settingsUpdateSchema);
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return jsonOk({ updated: 0 });

  await c.get('settings').setMany(Object.fromEntries(entries));
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'settings.updated',
    resource: 'settings',
    ip: c.get('clientIp'),
    metadata: { keys: entries.map(([key]) => key) },
  });
  return jsonOk({ updated: entries.length, settings: await c.get('settings').publicSettings() });
});

settingsRouter.get('/permissions', requirePermission('settings.read'), (_c) =>
  jsonOk({
    permissions: PERMISSIONS,
    all: ALL_PERMISSION_KEYS,
    roles: Object.entries(ROLE_LABELS_FA).map(([key, labelFa]) => ({ key, labelFa })),
  }),
);

/* ------------------------------- مدیران پنل ------------------------------- */

settingsRouter.get('/admins', requirePermission('admins.manage'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    `SELECT a.id, a.username, a.email, a.enabled, a.totp_enabled, a.last_login_at, a.created_at,
            r.name AS role_name
       FROM admins a JOIN roles r ON r.id = a.role_id
      ORDER BY a.created_at`,
  ).all<{
    id: string;
    username: string;
    email: string | null;
    enabled: number;
    totp_enabled: number;
    last_login_at: string | null;
    created_at: string;
    role_name: string;
  }>();

  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      enabled: row.enabled === 1,
      totpEnabled: row.totp_enabled === 1,
      role: row.role_name,
      roleLabelFa: ROLE_LABELS_FA[row.role_name as keyof typeof ROLE_LABELS_FA] ?? row.role_name,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    })),
  });
});

settingsRouter.post('/admins', requirePermission('admins.manage'), async (c) => {
  const input = await parseJson(c, adminCreateSchema);
  const existing = await c.env.AFRA_DB.prepare('SELECT id FROM admins WHERE username = ?')
    .bind(input.username)
    .first<{ id: string }>();
  if (existing) throw new AfraError('DUPLICATE', 409, undefined, 'این نام کاربری قبلاً ثبت شده است.');

  const id = newId('adm');
  await c.env.AFRA_DB.prepare(
    `INSERT INTO admins (id, username, email, password_hash, role_id, enabled, password_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(
      id,
      input.username,
      input.email || null,
      await hashPassword(input.password),
      input.role,
      nowIso(),
      nowIso(),
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'admin.created',
    resource: 'admin',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { role: input.role },
  });
  return jsonOk({ id }, 201);
});

settingsRouter.delete('/admins/:id', requirePermission('admins.manage'), async (c) => {
  const id = requireParam(c, 'id');
  const auth = c.get('auth');
  if (auth?.adminId === id) {
    throw new AfraError('VALIDATION_ERROR', 400, undefined, 'نمی‌توانید حساب خودتان را حذف کنید.');
  }

  const count = await c.env.AFRA_DB.prepare(
    "SELECT COUNT(*) AS total FROM admins WHERE role_id = 'super_admin' AND enabled = 1",
  ).first<{ total: number }>();
  const target = await c.env.AFRA_DB.prepare('SELECT role_id FROM admins WHERE id = ?')
    .bind(id)
    .first<{ role_id: string }>();
  if (!target) throw new AfraError('NOT_FOUND', 404);
  if (target.role_id === 'super_admin' && (count?.total ?? 0) <= 1) {
    throw new AfraError('VALIDATION_ERROR', 400, undefined, 'حداقل یک مدیر ارشد باید باقی بماند.');
  }

  await revokeAllSessions(c.env, id);
  await c.env.AFRA_DB.prepare('DELETE FROM admins WHERE id = ?').bind(id).run();
  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'admin.deleted',
    resource: 'admin',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});
