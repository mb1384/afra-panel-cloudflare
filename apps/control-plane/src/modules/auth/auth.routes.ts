import {
  AfraError,
  ROLE_LABELS_FA,
  ROLE_PERMISSIONS,
  loginSchema,
  passwordChangeSchema,
  totpVerifySchema,
} from '@afra/shared';
import type { RoleName } from '@afra/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import {
  buildTotpUri,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
  verifyTotp,
} from '../../core/crypto.js';
import { generateRecoveryCode } from '../../core/recovery.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth } from '../../core/middleware.js';
import { jsonFail, jsonOk } from '../../core/response.js';
import {
  SESSION_COOKIE,
  buildClearCookies,
  buildSessionCookies,
  createSession,
  parseCookies,
  revokeAllSessions,
  revokeSessionByToken,
} from '../../core/session.js';
import { parseJson } from '../../core/validate.js';

const FAILURE_WINDOW_MINUTES = 15;

interface AdminAuthRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  enabled: number;
  role_name: RoleName;
  recovery_code_hash: string | null;
}

async function findAdminByUsername(
  env: AppEnv['Bindings'],
  username: string,
): Promise<AdminAuthRow | null> {
  return env.AFRA_DB.prepare(
    `SELECT a.id, a.username, a.email, a.password_hash, a.totp_secret_enc, a.totp_enabled,
            a.enabled, a.recovery_code_hash, r.name AS role_name
       FROM admins a JOIN roles r ON r.id = a.role_id
      WHERE a.username = ?`,
  )
    .bind(username)
    .first<AdminAuthRow>();
}

async function recordAttempt(
  env: AppEnv['Bindings'],
  username: string,
  ip: string | null,
  success: boolean,
  reason?: string,
): Promise<void> {
  await env.AFRA_DB.prepare(
    'INSERT INTO login_attempts (id, username, ip, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(newId('att'), username, ip, success ? 1 : 0, reason ?? null, nowIso())
    .run();
}

async function recentFailureCount(
  env: AppEnv['Bindings'],
  username: string,
): Promise<number> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  const row = await env.AFRA_DB.prepare(
    'SELECT COUNT(*) AS total FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?',
  )
    .bind(username, since)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

function isSecureRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

export const authRouter = new Hono<AppEnv>();

/** ورود مدیر — دارای محدودسازی نرخ و محافظت brute-force. */
authRouter.post('/login', async (c) => {
  const input = await parseJson(c, loginSchema);
  const settings = await c.get('settings').load();
  const ip = c.get('clientIp');
  const logger = c.get('logger');

  const failures = await recentFailureCount(c.env, input.username);
  if (failures >= settings.loginRateLimit) {
    await writeAudit(c.env, {
      action: 'auth.login.blocked',
      resource: 'admin',
      result: 'failure',
      ip,
      metadata: { username: input.username, failures },
    });
    return jsonFail('RATE_LIMITED', 429, { retryAfter: FAILURE_WINDOW_MINUTES * 60 });
  }

  const admin = await findAdminByUsername(c.env, input.username);
  if (!admin || admin.enabled !== 1) {
    await recordAttempt(c.env, input.username, ip, false, 'unknown_or_disabled');
    return jsonFail('INVALID_CREDENTIALS', 401);
  }

  const passwordOk = await verifyPassword(input.password, admin.password_hash);
  if (!passwordOk) {
    await recordAttempt(c.env, input.username, ip, false, 'bad_password');
    await writeAudit(c.env, {
      action: 'auth.login.failed',
      resource: 'admin',
      resourceId: admin.id,
      result: 'failure',
      ip,
      metadata: { username: input.username },
    });
    return jsonFail('INVALID_CREDENTIALS', 401);
  }

  if (admin.totp_enabled === 1) {
    if (!input.totp) {
      return jsonFail('TOTP_REQUIRED', 401);
    }
    const secret = admin.totp_secret_enc
      ? await decryptSecret(admin.totp_secret_enc, c.env.AFRA_SECRET_KEY)
      : null;
    if (!secret || !(await verifyTotp(secret, input.totp))) {
      await recordAttempt(c.env, input.username, ip, false, 'bad_totp');
      return jsonFail('TOTP_INVALID', 401);
    }
  }

  const session = await createSession(
    c.env,
    { id: admin.id, username: admin.username, roleName: admin.role_name },
    {
      ip,
      userAgent: c.req.header('user-agent') ?? null,
      ttlMinutes: settings.sessionTtlMinutes,
    },
  );

  await c.env.AFRA_DB.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?')
    .bind(nowIso(), admin.id)
    .run();
  await recordAttempt(c.env, input.username, ip, true);
  await writeAudit(c.env, {
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'auth.login',
    resource: 'admin',
    resourceId: admin.id,
    ip,
  });
  logger.info('admin logged in', { adminId: admin.id });

  const cookies = buildSessionCookies(session, {
    secure: isSecureRequest(c.req.url),
    maxAgeSeconds: settings.sessionTtlMinutes * 60,
  });

  const response = jsonOk({
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role_name,
      roleLabelFa: ROLE_LABELS_FA[admin.role_name],
      totpEnabled: admin.totp_enabled === 1,
    },
    permissions: ROLE_PERMISSIONS[admin.role_name] ?? [],
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
});

authRouter.post('/logout', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies[SESSION_COOKIE];
  if (token) await revokeSessionByToken(c.env, token);
  const response = jsonOk({ loggedOut: true });
  for (const cookie of buildClearCookies(isSecureRequest(c.req.url))) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
});

authRouter.get('/me', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const settings = await c.get('settings').load();

  const admin = await c.env.AFRA_DB.prepare(
    'SELECT id, username, email, totp_enabled, last_login_at, created_at FROM admins WHERE id = ?',
  )
    .bind(auth.adminId)
    .first<{
      id: string;
      username: string;
      email: string | null;
      totp_enabled: number;
      last_login_at: string | null;
      created_at: string;
    }>();

  if (!admin) throw new AfraError('UNAUTHENTICATED', 401);

  return jsonOk({
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: auth.role,
      roleLabelFa: ROLE_LABELS_FA[auth.role],
      totpEnabled: admin.totp_enabled === 1,
      lastLoginAt: admin.last_login_at,
      createdAt: admin.created_at,
    },
    permissions: auth.permissions,
    csrfToken: auth.csrfSecret,
    settings: {
      panelName: settings.panelName,
      language: settings.language,
      theme: settings.theme,
      calendar: settings.calendar,
      timezone: settings.timezone,
      edgeUrl: settings.edgeUrl,
      maintenanceMode: settings.maintenanceMode,
      environment: c.env.AFRA_ENV,
      version: c.env.AFRA_VERSION,
    },
  });
});

authRouter.post('/password', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const input = await parseJson(c, passwordChangeSchema);

  const admin = await c.env.AFRA_DB.prepare('SELECT password_hash FROM admins WHERE id = ?')
    .bind(auth.adminId)
    .first<{ password_hash: string }>();
  if (!admin) throw new AfraError('UNAUTHENTICATED', 401);

  if (!(await verifyPassword(input.currentPassword, admin.password_hash))) {
    await writeAudit(c.env, {
      adminId: auth.adminId,
      adminUsername: auth.username,
      action: 'auth.password.change',
      result: 'failure',
      ip: c.get('clientIp'),
    });
    return jsonFail('INVALID_CREDENTIALS', 401);
  }

  const hash = await hashPassword(input.newPassword);
  await c.env.AFRA_DB.prepare(
    'UPDATE admins SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(hash, nowIso(), nowIso(), auth.adminId)
    .run();

  // همهٔ نشست‌های دیگر باطل می‌شوند
  const revoked = await revokeAllSessions(c.env, auth.adminId, auth.sessionId);
  await writeAudit(c.env, {
    adminId: auth.adminId,
    adminUsername: auth.username,
    action: 'auth.password.change',
    resource: 'admin',
    resourceId: auth.adminId,
    ip: c.get('clientIp'),
    metadata: { revokedSessions: revoked },
  });

  return jsonOk({ changed: true, revokedSessions: revoked });
});

/* ------------------------------- TOTP (2FA) ------------------------------- */

authRouter.post('/totp/setup', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const secret = generateTotpSecret();
  const encrypted = await encryptSecret(secret, c.env.AFRA_SECRET_KEY);
  await c.env.AFRA_DB.prepare(
    'UPDATE admins SET totp_secret_enc = ?, totp_enabled = 0, updated_at = ? WHERE id = ?',
  )
    .bind(encrypted, nowIso(), auth.adminId)
    .run();
  return jsonOk({ secret, uri: buildTotpUri(secret, auth.username) });
});

authRouter.post('/totp/enable', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const input = await parseJson(c, totpVerifySchema);

  const row = await c.env.AFRA_DB.prepare('SELECT totp_secret_enc FROM admins WHERE id = ?')
    .bind(auth.adminId)
    .first<{ totp_secret_enc: string | null }>();
  const secret = row?.totp_secret_enc
    ? await decryptSecret(row.totp_secret_enc, c.env.AFRA_SECRET_KEY)
    : null;
  if (!secret) throw new AfraError('VALIDATION_ERROR', 400, { reason: 'totp_not_initialized' });
  if (!(await verifyTotp(secret, input.code))) return jsonFail('TOTP_INVALID', 400);

  await c.env.AFRA_DB.prepare('UPDATE admins SET totp_enabled = 1, updated_at = ? WHERE id = ?')
    .bind(nowIso(), auth.adminId)
    .run();
  await writeAudit(c.env, {
    adminId: auth.adminId,
    adminUsername: auth.username,
    action: 'auth.totp.enabled',
    resource: 'admin',
    resourceId: auth.adminId,
    ip: c.get('clientIp'),
  });
  return jsonOk({ enabled: true });
});

authRouter.post('/totp/disable', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const input = await parseJson(c, totpVerifySchema);

  const row = await c.env.AFRA_DB.prepare(
    'SELECT totp_secret_enc, totp_enabled FROM admins WHERE id = ?',
  )
    .bind(auth.adminId)
    .first<{ totp_secret_enc: string | null; totp_enabled: number }>();
  if (!row || row.totp_enabled !== 1) return jsonOk({ enabled: false });

  const secret = row.totp_secret_enc
    ? await decryptSecret(row.totp_secret_enc, c.env.AFRA_SECRET_KEY)
    : null;
  if (!secret || !(await verifyTotp(secret, input.code))) return jsonFail('TOTP_INVALID', 400);

  await c.env.AFRA_DB.prepare(
    'UPDATE admins SET totp_enabled = 0, totp_secret_enc = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), auth.adminId)
    .run();
  await writeAudit(c.env, {
    adminId: auth.adminId,
    adminUsername: auth.username,
    action: 'auth.totp.disabled',
    resource: 'admin',
    resourceId: auth.adminId,
    ip: c.get('clientIp'),
  });
  return jsonOk({ enabled: false });
});

/* ------------------------------- نشست‌ها ------------------------------- */

authRouter.get('/sessions', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const rows = await c.env.AFRA_DB.prepare(
    `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
      WHERE admin_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(auth.adminId, nowIso())
    .all<{
      id: string;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
      last_seen_at: string | null;
      expires_at: string;
    }>();

  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      current: row.id === auth.sessionId,
    })),
  });
});

authRouter.post('/sessions/revoke-others', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
  const revoked = await revokeAllSessions(c.env, auth.adminId, auth.sessionId);
  await writeAudit(c.env, {
    adminId: auth.adminId,
    adminUsername: auth.username,
    action: 'auth.sessions.revoked',
    ip: c.get('clientIp'),
    metadata: { revoked },
  });
  return jsonOk({ revoked });
});

/* ------------------------------- بازیابی دسترسی ------------------------------- */

/**
 * بازیابی با کد بازیابی که در پایان راه‌اندازی اولیه یک‌بار نمایش داده می‌شود.
 * پس از استفاده، کد باطل و کد جدید صادر می‌شود.
 */
const recoverSchema = z.object({
  username: z.string().trim().min(3).max(64),
  recoveryCode: z.string().trim().min(8).max(40),
  newPassword: z
    .string()
    .min(12, { message: 'گذرواژه باید حداقل ۱۲ نویسه باشد.' })
    .max(200)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
});

authRouter.post('/recover', async (c) => {
  const input = await parseJson(c, recoverSchema);

  const admin = await findAdminByUsername(c.env, input.username);
  const providedHash = await sha256Hex(input.recoveryCode.trim().toUpperCase());
  if (
    !admin ||
    !admin.recovery_code_hash ||
    !timingSafeEqual(admin.recovery_code_hash, providedHash)
  ) {
    await recordAttempt(c.env, input.username, c.get('clientIp'), false, 'bad_recovery_code');
    return jsonFail('INVALID_CREDENTIALS', 401);
  }

  const newRecovery = generateRecoveryCode();
  await c.env.AFRA_DB.prepare(
    `UPDATE admins
        SET password_hash = ?, recovery_code_hash = ?, totp_enabled = 0, totp_secret_enc = NULL,
            password_changed_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      await hashPassword(input.newPassword),
      await sha256Hex(newRecovery),
      nowIso(),
      nowIso(),
      admin.id,
    )
    .run();
  await revokeAllSessions(c.env, admin.id);
  await writeAudit(c.env, {
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'auth.recovered',
    resource: 'admin',
    resourceId: admin.id,
    ip: c.get('clientIp'),
  });

  return jsonOk({ recovered: true, recoveryCode: newRecovery });
});
