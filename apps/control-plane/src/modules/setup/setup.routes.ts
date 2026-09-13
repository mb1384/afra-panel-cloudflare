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
  const passwordHash = await hashPassword(input.password);
  const recoveryCodeHash = await sha256Hex(recoveryCode);
  const createdAt = nowIso();

  try {
    const results = await c.env.AFRA_DB.batch([
      c.env.AFRA_DB.prepare(
        `INSERT INTO admins (id, username, email, password_hash, role_id, enabled, recovery_code_hash,
                             password_changed_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'super_admin', 1, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM admins)`,
      ).bind(
        adminId,
        input.username,
        input.email || null,
        passwordHash,
        recoveryCodeHash,
        createdAt,
        createdAt,
        createdAt,
      ),
      ...Object.entries({
        panelName: input.panelName,
        timezone: input.timezone,
        edgeUrl: input.edgeUrl || '',
        setupCompleted: true,
      }).map(([key, value]) =>
        c.env.AFRA_DB.prepare(
          `INSERT INTO system_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(key, JSON.stringify(value), 0, createdAt),
      ),
    ]);

    // D1 batch is atomic, but the conditional INSERT can legitimately affect
    // zero rows when another request completed setup first.
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      throw new AfraError('SETUP_ALREADY_DONE', 409);
    }
  } catch (error) {
    if (error instanceof AfraError) throw error;

    const currentCount = await c.env.AFRA_DB.prepare('SELECT COUNT(*) AS total FROM admins').first<{
      total: number;
    }>();
    if ((currentCount?.total ?? 0) > 0) {
      throw new AfraError('SETUP_ALREADY_DONE', 409);
    }
    throw error;
  }

  // Keep the in-request settings cache consistent with the D1 write.
  await settingsService.invalidate();

  let session;
  try {
    session = await createSession(
      c.env,
      { id: adminId, username: input.username, roleName: 'super_admin' },
      {
        ip: c.get('clientIp'),
        userAgent: c.req.header('user-agent') ?? null,
        ttlMinutes: 720,
      },
    );
  } catch (error) {
    // Setup data is already committed. Do not report a misleading generic failure;
    // the caller can retry authentication, while the created admin remains intact.
    throw new AfraError(
      'INTERNAL_ERROR',
      500,
      { phase: 'session_creation', reason: String(error) },
      'مدیر اولیه ساخته شد، اما ایجاد نشست ورود انجام نشد. اکنون از صفحه ورود وارد شوید.',
    );
  }

  // Audit logging must not invalidate an otherwise successful first setup.
  await writeAudit(c.env, {
    adminId,
    adminUsername: input.username,
    action: 'setup.completed',
    resource: 'admin',
    resourceId: adminId,
    ip: c.get('clientIp'),
  }).catch(() => undefined);

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
