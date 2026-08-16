import { AfraError } from '@afra/shared';
import type { PermissionKey } from '@afra/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context.js';
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  parseCookies,
  resolveSession,
  verifyCsrf,
} from './session.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** احراز هویت نشست + بررسی CSRF برای درخواست‌های تغییردهنده. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies[SESSION_COOKIE] ?? null;
  const auth = await resolveSession(c.env, token);
  if (!auth) throw new AfraError('UNAUTHENTICATED', 401);

  if (MUTATING_METHODS.has(c.req.method)) {
    const headerValue = c.req.header(CSRF_HEADER) ?? null;
    if (!verifyCsrf(auth, headerValue)) throw new AfraError('CSRF_INVALID', 403);
  }

  c.set('auth', auth);
  await next();
};

/** بررسی مجوز دانه‌ای. requireAuth باید قبل از آن اجرا شده باشد. */
export function requirePermission(permission: PermissionKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw new AfraError('UNAUTHENTICATED', 401);
    if (!auth.permissions.includes(permission)) {
      throw new AfraError('FORBIDDEN', 403, { required: permission });
    }
    await next();
  };
}

/** محدودسازی نرخ درخواست با Durable Object. */
export function rateLimit(options: {
  bucket: string;
  limit: number;
  windowSeconds: number;
  keyFrom?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = options.keyFrom ? options.keyFrom(c) : c.get('clientIp');
    const key = `${options.bucket}:${identity}`;
    const stub = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(key));
    const response = await stub.fetch('https://afra.internal/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: options.limit, windowSeconds: options.windowSeconds }),
    });
    const result = (await response.json()) as { allowed: boolean; retryAfter: number };
    if (!result.allowed) {
      throw new AfraError('RATE_LIMITED', 429, { retryAfter: result.retryAfter });
    }
    await next();
  };
}

/** مسدودسازی نوشتن در حالت تعمیرات (به‌جز مدیر ارشد). */
export const maintenanceGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method)) return next();
  const settings = await c.get('settings').load();
  const auth = c.get('auth');
  if (settings.maintenanceMode && auth?.role !== 'super_admin') {
    throw new AfraError('FORBIDDEN', 503, undefined, 'سامانه در حالت تعمیرات است.');
  }
  await next();
};
