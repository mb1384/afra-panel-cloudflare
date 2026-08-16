import { AfraError, listSubFormats } from '@afra/shared';
import type { SubscriptionFormat } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { newToken, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { requireParam } from '../../core/validate.js';
import {
  buildSubscriptionUrls,
  findSubscriptionByToken,
  renderSubscription,
  subscriptionDenyReason,
} from './subscriptions.service.js';

/* --------------------------- مسیر عمومی تحویل اشتراک --------------------------- */

export const publicSubscriptionRouter = new Hono<AppEnv>();

/**
 * تحویل اشتراک. این مسیر عمومی است اما توکن یک اعتبارنامه محسوب می‌شود؛
 * بنابراین در لاگ‌ها ثبت نمی‌شود و پاسخ کش نمی‌گردد.
 * در استقرار تولیدی توصیه می‌شود از Worker لبه (afra-edge) استفاده شود.
 */
publicSubscriptionRouter.get('/:token', async (c) => {
  const token = requireParam(c, 'token');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    return new Response('اشتراک یافت نشد.', { status: 404 });
  }

  const context = await findSubscriptionByToken(c.env, token);
  if (!context) return new Response('اشتراک یافت نشد.', { status: 404 });
  if (context.revokedAt) return new Response('این اشتراک لغو شده است.', { status: 403 });

  const deny = subscriptionDenyReason(context.user);
  if (deny) {
    const messages: Record<string, string> = {
      disabled: 'حساب کاربری غیرفعال است.',
      expired: 'اشتراک منقضی شده است.',
      exhausted: 'حجم مجاز به پایان رسیده است.',
    };
    return new Response(messages[deny] ?? 'اشتراک در دسترس نیست.', { status: 403 });
  }

  const formatParam = c.req.query('format');
  const requestedFormat: SubscriptionFormat | null =
    formatParam === 'auto' || formatParam === 'base64' || formatParam === 'clash'
      ? formatParam
      : null;

  const settings = await c.get('settings').load();
  const result = await renderSubscription(c.env, context, {
    requestedFormat,
    userAgent: c.req.header('user-agent') ?? null,
    settings,
  });

  await c.env.AFRA_DB.prepare(
    'UPDATE subscriptions SET access_count = access_count + 1, last_access_at = ? WHERE id = ?',
  )
    .bind(nowIso(), context.subscriptionId)
    .run()
    .catch(() => undefined);

  return new Response(result.body, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      ...result.headers,
    },
  });
});

/* ------------------------------ مدیریت اشتراک‌ها ------------------------------ */

export const subscriptionsRouter = new Hono<AppEnv>();
subscriptionsRouter.use('*', requireAuth);

subscriptionsRouter.get('/formats', requirePermission('subscriptions.read'), (_c) =>
  jsonOk({
    formats: listSubFormats().map((format) => ({
      key: format.key,
      labelFa: format.labelFa,
      contentType: format.contentType,
    })),
  }),
);

subscriptionsRouter.get('/', requirePermission('subscriptions.read'), async (c) => {
  const settings = await c.get('settings').load();
  const rows = await c.env.AFRA_DB.prepare(
    `SELECT s.id, s.token, s.format, s.revoked_at, s.rotated_at, s.access_count, s.last_access_at,
            s.created_at, u.id AS user_id, u.name AS user_name, u.username
       FROM subscriptions s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 500`,
  ).all<{
    id: string;
    token: string;
    format: string;
    revoked_at: string | null;
    rotated_at: string | null;
    access_count: number;
    last_access_at: string | null;
    created_at: string;
    user_id: string;
    user_name: string;
    username: string;
  }>();

  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      username: row.username,
      format: row.format,
      revokedAt: row.revoked_at,
      rotatedAt: row.rotated_at,
      accessCount: row.access_count,
      lastAccessAt: row.last_access_at,
      createdAt: row.created_at,
      ...buildSubscriptionUrls(row.token, settings.edgeUrl, c.req.url),
    })),
  });
});

subscriptionsRouter.post('/:id/revoke', requirePermission('subscriptions.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare(
    'UPDATE subscriptions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('SUBSCRIPTION_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'subscription.revoked',
    resource: 'subscription',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ revoked: true });
});

subscriptionsRouter.post('/:id/regenerate', requirePermission('subscriptions.write'), async (c) => {
  const id = requireParam(c, 'id');
  const token = newToken(32);
  const result = await c.env.AFRA_DB.prepare(
    'UPDATE subscriptions SET token = ?, rotated_at = ?, revoked_at = NULL WHERE id = ?',
  )
    .bind(token, nowIso(), id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('SUBSCRIPTION_NOT_FOUND', 404);
  const settings = await c.get('settings').load();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'subscription.regenerated',
    resource: 'subscription',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk(buildSubscriptionUrls(token, settings.edgeUrl, c.req.url));
});
