import { AfraError, paginationSchema } from '@afra/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../core/context.js';
import { nowIso } from '../../core/ids.js';
import { requireAuth } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { rowToNotification } from '../../db/mappers.js';
import { parseQuery, requireParam } from '../../core/validate.js';

export const notificationsRouter = new Hono<AppEnv>();
notificationsRouter.use('*', requireAuth);

notificationsRouter.get('/', async (c) => {
  const query = parseQuery(c, paginationSchema);
  const offset = (query.page - 1) * query.pageSize;
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?',
  )
    .bind(query.pageSize, offset)
    .all<Parameters<typeof rowToNotification>[0]>();
  const unread = await c.env.AFRA_DB.prepare(
    'SELECT COUNT(*) AS total FROM notifications WHERE read_at IS NULL',
  ).first<{ total: number }>();

  return jsonOk({
    items: (rows.results ?? []).map(rowToNotification),
    unread: unread?.total ?? 0,
  });
});

notificationsRouter.post('/:id/read', async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL',
  )
    .bind(nowIso(), id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  return jsonOk({ read: true });
});

notificationsRouter.post('/read-all', async (c) => {
  const result = await c.env.AFRA_DB.prepare(
    'UPDATE notifications SET read_at = ? WHERE read_at IS NULL',
  )
    .bind(nowIso())
    .run();
  return jsonOk({ marked: result.meta.changes ?? 0 });
});

notificationsRouter.delete('/:id', async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM notifications WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  return jsonOk({ deleted: true });
});
