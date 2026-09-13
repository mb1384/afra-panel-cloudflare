import { ROLE_PERMISSIONS } from '@afra/shared';
import type { RoleName } from '@afra/shared';
import type { AuthContext } from './context.js';
import { sha256Hex, timingSafeEqual } from './crypto.js';
import type { Bindings } from './env.js';
import { isoPlusMinutes, newId, newToken, nowIso } from './ids.js';

export const SESSION_COOKIE = 'afra_session';
export const CSRF_COOKIE = 'afra_csrf';
export const CSRF_HEADER = 'x-afra-csrf';

interface SessionCacheValue {
  sessionId: string;
  adminId: string;
  username: string;
  role: RoleName;
  permissions: string[];
  csrfSecret: string;
  expiresAt: string;
}

function kvKey(tokenHash: string): string {
  return `sess:${tokenHash}`;
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: string;
}

export async function createSession(
  env: Bindings,
  admin: { id: string; username: string; roleName: RoleName },
  options: { ip?: string | null; userAgent?: string | null; ttlMinutes: number },
): Promise<CreatedSession> {
  const token = newToken(32);
  const tokenHash = await sha256Hex(token);
  const csrfSecret = newToken(24);
  const sessionId = newId('ses');
  const expiresAt = isoPlusMinutes(options.ttlMinutes);
  const permissions = ROLE_PERMISSIONS[admin.roleName] ?? [];

  await env.AFRA_DB.prepare(
    `INSERT INTO sessions (id, admin_id, token_hash, csrf_secret, ip, user_agent, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      admin.id,
      tokenHash,
      csrfSecret,
      options.ip ?? null,
      (options.userAgent ?? '').slice(0, 250) || null,
      expiresAt,
      nowIso(),
      nowIso(),
    )
    .run();

  const cacheValue: SessionCacheValue = {
    sessionId,
    adminId: admin.id,
    username: admin.username,
    role: admin.roleName,
    permissions: [...permissions],
    csrfSecret,
    expiresAt,
  };

  // KV is only a session cache. A temporary KV failure must not make a
  // successfully persisted D1 session look like a failed login/setup.
  await env.AFRA_KV.put(kvKey(tokenHash), JSON.stringify(cacheValue), {
    expirationTtl: Math.max(60, options.ttlMinutes * 60),
  }).catch(() => undefined);

  return { token, csrfToken: csrfSecret, sessionId, expiresAt };
}

export async function resolveSession(
  env: Bindings,
  token: string | null,
): Promise<AuthContext | null> {
  if (!token || token.length < 20) return null;
  const tokenHash = await sha256Hex(token);

  const cached = (await env.AFRA_KV.get(kvKey(tokenHash), 'json').catch(
    () => null,
  )) as SessionCacheValue | null;

  if (cached) {
    if (Date.parse(cached.expiresAt) <= Date.now()) {
      await env.AFRA_KV.delete(kvKey(tokenHash)).catch(() => undefined);
      return null;
    }
    return {
      adminId: cached.adminId,
      username: cached.username,
      role: cached.role,
      permissions: cached.permissions,
      sessionId: cached.sessionId,
      csrfSecret: cached.csrfSecret,
    };
  }

  const row = await env.AFRA_DB.prepare(
    `SELECT s.id AS session_id, s.admin_id, s.csrf_secret, s.expires_at, s.revoked_at,
            a.username, a.enabled, r.name AS role_name
       FROM sessions s
       JOIN admins a ON a.id = s.admin_id
       JOIN roles r ON r.id = a.role_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      session_id: string;
      admin_id: string;
      csrf_secret: string;
      expires_at: string;
      revoked_at: string | null;
      username: string;
      enabled: number;
      role_name: RoleName;
    }>();

  if (!row || row.revoked_at || row.enabled !== 1) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;

  const permissions = [...(ROLE_PERMISSIONS[row.role_name] ?? [])];
  const cacheValue: SessionCacheValue = {
    sessionId: row.session_id,
    adminId: row.admin_id,
    username: row.username,
    role: row.role_name,
    permissions,
    csrfSecret: row.csrf_secret,
    expiresAt: row.expires_at,
  };
  const ttl = Math.max(60, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000));
  await env.AFRA_KV.put(kvKey(tokenHash), JSON.stringify(cacheValue), {
    expirationTtl: ttl,
  }).catch(() => undefined);

  return {
    adminId: row.admin_id,
    username: row.username,
    role: row.role_name,
    permissions,
    sessionId: row.session_id,
    csrfSecret: row.csrf_secret,
  };
}

export async function revokeSessionByToken(env: Bindings, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await env.AFRA_KV.delete(kvKey(tokenHash)).catch(() => undefined);
  await env.AFRA_DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
    .bind(nowIso(), tokenHash)
    .run();
}

export async function revokeAllSessions(
  env: Bindings,
  adminId: string,
  exceptSessionId?: string,
): Promise<number> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT id, token_hash FROM sessions WHERE admin_id = ? AND revoked_at IS NULL',
  )
    .bind(adminId)
    .all<{ id: string; token_hash: string }>();

  let count = 0;
  for (const row of rows.results ?? []) {
    if (exceptSessionId && row.id === exceptSessionId) continue;
    await env.AFRA_KV.delete(kvKey(row.token_hash)).catch(() => undefined);
    count += 1;
  }
  if (exceptSessionId) {
    await env.AFRA_DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL AND id <> ?',
    )
      .bind(nowIso(), adminId, exceptSessionId)
      .run();
  } else {
    await env.AFRA_DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL',
    )
      .bind(nowIso(), adminId)
      .run();
  }
  return count;
}

export function verifyCsrf(auth: AuthContext, headerValue: string | null): boolean {
  if (!headerValue) return false;
  return timingSafeEqual(auth.csrfSecret, headerValue);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildSessionCookies(
  session: CreatedSession,
  options: { secure: boolean; maxAgeSeconds: number },
): string[] {
  const flags = ['Path=/', 'SameSite=Strict', `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) flags.push('Secure');
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; HttpOnly; ${flags.join('; ')}`,
    // کوکی CSRF باید توسط JS خوانده شود، بنابراین HttpOnly ندارد.
    `${CSRF_COOKIE}=${encodeURIComponent(session.csrfToken)}; ${flags.join('; ')}`,
  ];
}

export function buildClearCookies(secure: boolean): string[] {
  const flags = ['Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return [
    `${SESSION_COOKIE}=; HttpOnly; ${flags.join('; ')}`,
    `${CSRF_COOKIE}=; ${flags.join('; ')}`,
  ];
}
