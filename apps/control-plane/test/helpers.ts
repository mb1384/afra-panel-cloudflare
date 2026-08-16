import { SELF, env } from 'cloudflare:test';
import { expect } from 'vitest';

const DATA_TABLES = [
  'sessions',
  'login_attempts',
  'admins',
  'user_nodes',
  'subscriptions',
  'users',
  'node_health_checks',
  'nodes',
  'traffic_samples',
  'notifications',
  'audit_logs',
  'app_logs',
  'proxy_chains',
  'backends',
  'warp_configs',
  'telegram_admins',
  'domain_filters',
  'cf_resources',
  'backups',
];

/**
 * پاک‌سازی داده‌های تست بین سنجه‌ها.
 * جداول پایه (نقش‌ها، مجوزها، تنظیمات، DNS و قواعد پیش‌فرض) دست‌نخورده می‌مانند.
 */
export async function resetDatabase(): Promise<void> {
  await env.AFRA_DB.batch(DATA_TABLES.map((table) => env.AFRA_DB.prepare(`DELETE FROM ${table}`)));
  await env.AFRA_DB.prepare(
    "UPDATE system_settings SET value = 'false' WHERE key = 'setupCompleted'",
  ).run();
  await env.AFRA_DB.prepare("DELETE FROM system_settings WHERE is_secret = 1").run();
  const listed = await env.AFRA_KV.list();
  for (const key of listed.keys) await env.AFRA_KV.delete(key.name);
}

export const SETUP_PAYLOAD = {
  username: 'afraadmin',
  email: 'admin@example.com',
  password: 'AfraTest-2026-Strong',
  panelName: 'پنل افرا',
  timezone: 'Asia/Tehran',
  edgeUrl: '',
};

export interface Session {
  cookie: string;
  csrf: string;
}

function collectCookies(response: Response): string {
  const values = response.headers.getAll
    ? response.headers.getAll('set-cookie')
    : [response.headers.get('set-cookie') ?? ''];
  return values
    .filter(Boolean)
    .map((value) => value.split(';')[0])
    .join('; ');
}

export async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** راه‌اندازی اولیه و ساخت نشست مدیر ارشد. */
export async function bootstrapAdmin(): Promise<Session> {
  const response = await SELF.fetch('https://afra.test/api/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SETUP_PAYLOAD),
  });
  expect(response.status).toBe(200);
  const body = await json<{ ok: boolean; data: { csrfToken: string; recoveryCode: string } }>(
    response,
  );
  expect(body.ok).toBe(true);
  return { cookie: collectCookies(response), csrf: body.data.csrfToken };
}

export async function login(
  username: string,
  password: string,
  totp?: string,
): Promise<{ response: Response; session: Session | null }> {
  const response = await SELF.fetch('https://afra.test/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, ...(totp ? { totp } : {}) }),
  });
  if (!response.ok) return { response, session: null };
  const body = await json<{ data: { csrfToken: string } }>(response.clone());
  return { response, session: { cookie: collectCookies(response), csrf: body.data.csrfToken } };
}

export function authedRequest(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('cookie', session.cookie);
  headers.set('x-afra-csrf', session.csrf);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return SELF.fetch(`https://afra.test${path}`, { ...init, headers });
}

export async function apiGet<T>(session: Session, path: string): Promise<T> {
  const response = await authedRequest(session, path);
  expect(response.status, `GET ${path} failed`).toBe(200);
  const body = await json<{ ok: boolean; data: T }>(response);
  expect(body.ok).toBe(true);
  return body.data;
}

export async function apiPost<T>(
  session: Session,
  path: string,
  payload: unknown,
  expectedStatus = 200,
): Promise<T> {
  const response = await authedRequest(session, path, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
  expect(response.status, `POST ${path} -> ${await response.clone().text()}`).toBe(expectedStatus);
  const body = await json<{ ok: boolean; data: T }>(response);
  return body.data;
}
