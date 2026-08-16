import { AfraError } from '@afra/shared';
import { Hono } from 'hono';
import type { AppEnv } from './core/context.js';
import { applySecurityHeaders } from './core/headers.js';
import type { Bindings } from './core/env.js';
import { newId } from './core/ids.js';
import { Logger } from './core/logger.js';
import { maintenanceGuard, rateLimit } from './core/middleware.js';
import { fromError, jsonFail, jsonOk } from './core/response.js';
import { SettingsService } from './core/settings.js';
import { handleScheduled } from './scheduled.js';

import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { backendsRouter, warpRouter } from './modules/backends/backends.routes.js';
import { backupRouter } from './modules/backup/backup.routes.js';
import { chainsRouter } from './modules/chains/chains.routes.js';
import { cloudflareRouter } from './modules/cloudflare/cloudflare.routes.js';
import { dnsRouter } from './modules/dns/dns.routes.js';
import { nodesRouter } from './modules/nodes/nodes.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { routingRouter } from './modules/routing/routing.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { setupRouter } from './modules/setup/setup.routes.js';
import {
  publicSubscriptionRouter,
  subscriptionsRouter,
} from './modules/subscriptions/subscriptions.routes.js';
import { telegramRouter, telegramWebhookRouter } from './modules/telegram/telegram.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export { RateLimiterDO } from './durable/rate-limiter.js';
export { HealthCoordinatorDO } from './durable/health-coordinator.js';

const app = new Hono<AppEnv>();

/* ---------------------------- میدل‌ویرهای پایه ---------------------------- */

app.use('*', async (c, next) => {
  const requestId = newId('req');
  const settings = new SettingsService(c.env);
  const config = await settings.load().catch(() => null);

  c.set('requestId', requestId);
  c.set('settings', settings);
  c.set('logger', new Logger(c.env, config?.logLevel ?? 'INFO', requestId));
  c.set(
    'clientIp',
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  );

  await next();

  // پاسخ بازسازی می‌شود تا هدرها روی پاسخ‌های immutable (مثل Static Assets) هم اعمال شوند
  c.res = applySecurityHeaders(c.res, requestId);
});

/** CORS محدود: در حالت توسعه، فرانت‌اند Vite اجازهٔ دسترسی دارد. */
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = new Set<string>();
  if (c.env.AFRA_PANEL_URL) allowed.add(c.env.AFRA_PANEL_URL.replace(/\/+$/, ''));
  if (c.env.AFRA_ENV === 'development') {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }
  allowed.add(new URL(c.req.url).origin);

  if (origin && allowed.has(origin)) {
    c.header('access-control-allow-origin', origin);
    c.header('access-control-allow-credentials', 'true');
    c.header('access-control-allow-headers', 'content-type, x-afra-csrf');
    c.header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    c.header('vary', 'origin');
  }

  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  await next();
});

app.onError((error, c) => {
  const logger = c.get('logger');
  if (!(error instanceof AfraError)) {
    logger?.error('unhandled error', { error: String(error), path: new URL(c.req.url).pathname });
  } else if (error.status >= 500) {
    logger?.error('server error', { code: error.code });
  }
  return fromError(error);
});

app.notFound(() => jsonFail('NOT_FOUND', 404));

/* ------------------------------ مسیرهای عمومی ------------------------------ */

app.get('/health', (c) =>
  jsonOk({
    ok: true,
    service: 'afra-control-plane',
    environment: c.env.AFRA_ENV,
    version: c.env.AFRA_VERSION,
    time: new Date().toISOString(),
  }),
);

app.get('/ready', async (c) => {
  try {
    await c.env.AFRA_DB.prepare('SELECT 1 AS ok').first();
    await c.env.AFRA_KV.get('readiness-probe');
    return jsonOk({ ready: true, database: 'ok', kv: 'ok' });
  } catch (error) {
    return jsonFail('INTERNAL_ERROR', 503, { reason: String(error) }, 'سرویس آماده نیست.');
  }
});

app.route('/sub', publicSubscriptionRouter);

/* --------------------------------- API v1 --------------------------------- */

const api = new Hono<AppEnv>();

api.use('*', rateLimit({ bucket: 'api', limit: 600, windowSeconds: 60 }));
api.use('*', maintenanceGuard);

api.route('/setup', setupRouter);
api.route('/auth', authRouter);
api.route('/users', usersRouter);
api.route('/subscriptions', subscriptionsRouter);
api.route('/nodes', nodesRouter);
api.route('/routing', routingRouter);
api.route('/dns', dnsRouter);
api.route('/proxy-chains', chainsRouter);
api.route('/backends', backendsRouter);
api.route('/warp', warpRouter);
api.route('/cloudflare', cloudflareRouter);
api.route('/telegram', telegramRouter);
// webhook روی مسیر مستقل قرار می‌گیرد تا میدل‌ویر احراز هویت روتر مدیریتی آن را نگیرد
api.route('/telegram-webhook', telegramWebhookRouter);
api.route('/notifications', notificationsRouter);
api.route('/analytics', analyticsRouter);
api.route('/audit', auditRouter);
api.route('/backup', backupRouter);
api.route('/settings', settingsRouter);

app.route('/api/v1', api);

/* ------------------------- رابط کاربری (Static Assets) ------------------------- */

app.all('*', async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/')) return jsonFail('NOT_FOUND', 404);
  if (!c.env.ASSETS) {
    return new Response(
      'رابط کاربری ساخته نشده است. ابتدا دستور `npm run build` را اجرا کنید.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(controller, env));
  },
};
