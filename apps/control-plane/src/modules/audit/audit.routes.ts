import { auditQuerySchema, paginationSchema } from '@afra/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../core/context.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { likePattern, rowToAudit, safeJson } from '../../db/mappers.js';
import { parseQuery } from '../../core/validate.js';

export const auditRouter = new Hono<AppEnv>();
auditRouter.use('*', requireAuth);

auditRouter.get('/', requirePermission('audit.read'), async (c) => {
  const query = parseQuery(c, auditQuerySchema);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push("(action LIKE ? ESCAPE '\\' OR admin_username LIKE ? ESCAPE '\\' OR resource_id LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.result !== 'all') {
    conditions.push('result = ?');
    params.push(query.result);
  }
  if (query.from) {
    conditions.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('created_at <= ?');
    params.push(query.to);
  }

  const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const offset = (query.page - 1) * query.pageSize;

  const rows = await c.env.AFRA_DB.prepare(
    `SELECT * FROM audit_logs${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, query.pageSize, offset)
    .all<Parameters<typeof rowToAudit>[0]>();

  const count = await c.env.AFRA_DB.prepare(`SELECT COUNT(*) AS total FROM audit_logs${whereSql}`)
    .bind(...params)
    .first<{ total: number }>();

  const actions = await c.env.AFRA_DB.prepare(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 100',
  ).all<{ action: string }>();

  const total = count?.total ?? 0;
  return jsonOk({
    items: (rows.results ?? []).map(rowToAudit),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    availableActions: (actions.results ?? []).map((row) => row.action),
  });
});

/** لاگ‌های سیستمی (سطح WARN و بالاتر) برای مشاهده در پنل. */
auditRouter.get('/logs', requirePermission('audit.read'), async (c) => {
  const query = parseQuery(c, paginationSchema);
  const offset = (query.page - 1) * query.pageSize;
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT id, level, message, context, created_at FROM app_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
  )
    .bind(query.pageSize, offset)
    .all<{ id: string; level: string; message: string; context: string | null; created_at: string }>();
  const count = await c.env.AFRA_DB.prepare('SELECT COUNT(*) AS total FROM app_logs').first<{
    total: number;
  }>();

  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      context: safeJson<Record<string, unknown> | null>(row.context, null),
      createdAt: row.created_at,
    })),
    total: count?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  });
});
