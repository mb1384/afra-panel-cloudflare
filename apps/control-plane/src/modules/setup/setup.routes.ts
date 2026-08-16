import { AfraError, ROLE_PERMISSIONS, setupSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { hashPassword, sha256Hex } from '../../core/crypto.js';
import { newId, nowIso } from '../../core/ids.js';
import { generateRecoveryCode } from '../../core/recovery.js';
import { jsonOk } from '../../core/response.js';
import { buildSessionCookies, createSession } from '../../core/session.js';
import { parseJson } from '../../core/validate.js';

export const setupRouter = new Hono<AppEnv>();

setupRouter.get('/status', async (c) => {
  const settings = await c.get('settings').load();
  const adminCount = await c.env.AFRA_DB.prepare('SELECT COUNT(*) AS total FROM admins').first<{
    total: number;
  }>();
  return jsonOk({
    completed: settings.setupCompleted === true && (adminCount?.total ?? 0) > 0,
    hasAdmin: (adminCount?.total ?? 0) > 0,
    environment: c.env.AFRA_ENV,
    version: c.env.AFRA_VERSION,
    panelName: settings.panelName,
    cloudflareConfigured: Boolean(c.env.CLOUDFLARE_ACCOUNT_ID && c.env.CLOUDFLARE_API_TOKEN),
    secretKeyConfigured: Boolean(c.env.AFRA_SECRET_KEY && c.env.AFRA_SECRET_KEY.length >= 24),
  });
});

/** ایجاد نخستین مدیر — فقط زمانی که هیچ مدیری وجود ندارد. */
setupRouter.post('/', async (c) => {
  const adminCount = await c.env.AFRA_DB.prepare('SELECT COUNT(*) AS total FROM admins').first<{
    total: number;
  }>();
  if ((adminCount?.total ?? 0) > 0) throw new AfraError('SETUP_ALREADY_DONE', 409);

  if (!c.env.AFRA_SECRET_KEY || c.env.AFRA_SECRET_KEY.length < 24) {
    throw new AfraError(
      'VALIDATION_ERROR',
      500,
      { reason: 'missing_secret_key' },
      'کلید AFRA_SECRET_KEY تنظیم نشده است. راهنمای نصب را ببینید.',
    );
  }

  const input = await parseJson(c, setupSchema);
  const settingsService = c.get('settings');
  const recoveryCode = generateRecoveryCode();
  const adminId = newId('adm');

  await c.env.AFRA_DB.prepare(
    `INSERT INTO admins (id, username, email, password_hash, role_id, enabled, recovery_code_hash,
                         password_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super_admin', 1, ?, ?, ?, ?)`,
  )
    .bind(
      adminId,
      input.username,
      input.email || null,
      await hashPassword(input.password),
      await sha256Hex(recoveryCode),
      nowIso(),
      nowIso(),
      nowIso(),
    )
    .run();

  await settingsService.setMany({
    panelName: input.panelName,
    timezone: input.timezone,
    edgeUrl: input.edgeUrl || '',
    setupCompleted: true,
  });

  const session = await createSession(
    c.env,
    { id: adminId, username: input.username, roleName: 'super_admin' },
    {
      ip: c.get('clientIp'),
      userAgent: c.req.header('user-agent') ?? null,
      ttlMinutes: 720,
    },
  );

  await writeAudit(c.env, {
    adminId,
    adminUsername: input.username,
    action: 'setup.completed',
    resource: 'admin',
    resourceId: adminId,
    ip: c.get('clientIp'),
  });

  const response = jsonOk({
    completed: true,
    recoveryCode,
    admin: { id: adminId, username: input.username, role: 'super_admin' },
    permissions: ROLE_PERMISSIONS.super_admin,
    csrfToken: session.csrfToken,
  });
  for (const cookie of buildSessionCookies(session, {
    secure: new URL(c.req.url).protocol === 'https:',
    maxAgeSeconds: 720 * 60,
  })) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
});
