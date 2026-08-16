import {
  AfraError,
  formatBytes,
  getProtocolAdapter,
  parseNodeRow,
  userExtendSchema,
  userBulkSchema,
  userCreateSchema,
  userQuerySchema,
  userUpdateSchema,
} from '@afra/shared';
import type { ProxyNode } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { newToken, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseJson, parseQuery, requireParam } from '../../core/validate.js';
import { buildSubscriptionUrls } from '../subscriptions/subscriptions.service.js';
import {
  createUser,
  deleteUser,
  extendUser,
  getUserById,
  listUsers,
  resetTraffic,
  rotateCredentials,
  setEnabled,
  updateUser,
  userStateOf,
} from './users.service.js';

export const usersRouter = new Hono<AppEnv>();
usersRouter.use('*', requireAuth);

usersRouter.get('/', requirePermission('users.read'), async (c) => {
  const query = parseQuery(c, userQuerySchema);
  const { items, total } = await listUsers(c.env, query);
  return jsonOk({
    items: items.map((user) => ({
      ...user,
      state: userStateOf(user),
      usedBytesLabel: formatBytes(user.usedBytes),
      quotaLabel: formatBytes(user.quotaBytes),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  });
});

usersRouter.post('/', requirePermission('users.write'), async (c) => {
  const input = await parseJson(c, userCreateSchema);
  const auth = c.get('auth');

  const existing = await c.env.AFRA_DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(input.username)
    .first<{ id: string }>();
  if (existing) throw new AfraError('USERNAME_TAKEN', 409);

  const { user, subscriptionToken } = await createUser(c.env, input);
  const settings = await c.get('settings').load();

  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'user.created',
    resource: 'user',
    resourceId: user.id,
    ip: c.get('clientIp'),
    metadata: { username: user.username, quotaBytes: user.quotaBytes },
  });

  return jsonOk(
    {
      user: { ...user, state: userStateOf(user) },
      subscription: buildSubscriptionUrls(subscriptionToken, settings.edgeUrl, c.req.url),
    },
    201,
  );
});

usersRouter.get('/:id', requirePermission('users.read'), async (c) => {
  const user = await getUserById(c.env, requireParam(c, 'id'));
  if (!user) throw new AfraError('USER_NOT_FOUND', 404);
  const settings = await c.get('settings').load();
  const subscription = await c.env.AFRA_DB.prepare(
    'SELECT token, format, revoked_at, access_count, last_access_at FROM subscriptions WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{
      token: string;
      format: string;
      revoked_at: string | null;
      access_count: number;
      last_access_at: string | null;
    }>();

  return jsonOk({
    user: { ...user, state: userStateOf(user) },
    subscription: subscription
      ? {
          format: subscription.format,
          revokedAt: subscription.revoked_at,
          accessCount: subscription.access_count,
          lastAccessAt: subscription.last_access_at,
          ...buildSubscriptionUrls(subscription.token, settings.edgeUrl, c.req.url),
        }
      : null,
  });
});

usersRouter.patch('/:id', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, userUpdateSchema);
  const auth = c.get('auth');

  if (input.username) {
    const clash = await c.env.AFRA_DB.prepare(
      'SELECT id FROM users WHERE username = ? AND id <> ?',
    )
      .bind(input.username, id)
      .first<{ id: string }>();
    if (clash) throw new AfraError('USERNAME_TAKEN', 409);
  }

  const user = await updateUser(c.env, id, input);
  if (!user) throw new AfraError('USER_NOT_FOUND', 404);

  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'user.updated',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { fields: Object.keys(input) },
  });
  return jsonOk({ user: { ...user, state: userStateOf(user) } });
});

usersRouter.delete('/:id', requirePermission('users.delete'), async (c) => {
  const id = requireParam(c, 'id');
  const auth = c.get('auth');
  const deleted = await deleteUser(c.env, id);
  if (!deleted) throw new AfraError('USER_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: 'user.deleted',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

usersRouter.post('/:id/enable', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  await setEnabled(c.env, id, true);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'user.enabled',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ enabled: true });
});

usersRouter.post('/:id/disable', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  await setEnabled(c.env, id, false);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'user.disabled',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ enabled: false });
});

usersRouter.post('/:id/reset-traffic', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  await resetTraffic(c.env, id);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'user.traffic.reset',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ reset: true });
});

usersRouter.post('/:id/extend', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, userExtendSchema);
  const expiresAt = await extendUser(c.env, id, input.days);
  if (!expiresAt) throw new AfraError('USER_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'user.extended',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { days: input.days },
  });
  return jsonOk({ expiresAt });
});

usersRouter.post('/:id/rotate-credentials', requirePermission('users.write'), async (c) => {
  const id = requireParam(c, 'id');
  const user = await rotateCredentials(c.env, id);
  if (!user) throw new AfraError('USER_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'user.credentials.rotated',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ user: { ...user, state: userStateOf(user) } });
});

usersRouter.post('/:id/rotate-token', requirePermission('subscriptions.write'), async (c) => {
  const id = requireParam(c, 'id');
  const token = newToken(32);
  const result = await c.env.AFRA_DB.prepare(
    'UPDATE subscriptions SET token = ?, rotated_at = ?, revoked_at = NULL WHERE user_id = ?',
  )
    .bind(token, nowIso(), id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('SUBSCRIPTION_NOT_FOUND', 404);

  const settings = await c.get('settings').load();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'subscription.token.rotated',
    resource: 'user',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ subscription: buildSubscriptionUrls(token, settings.edgeUrl, c.req.url) });
});

/** کانفیگ کلاینت برای هر Node اختصاص‌یافته (برای کپی و QR). */
usersRouter.get('/:id/configs', requirePermission('users.read'), async (c) => {
  const id = requireParam(c, 'id');
  const user = await getUserById(c.env, id);
  if (!user) throw new AfraError('USER_NOT_FOUND', 404);

  const rows =
    user.nodeIds.length > 0
      ? await c.env.AFRA_DB.prepare(
          `SELECT * FROM nodes WHERE enabled = 1 AND id IN (${user.nodeIds.map(() => '?').join(',')})`,
        )
          .bind(...user.nodeIds)
          .all()
      : await c.env.AFRA_DB.prepare('SELECT * FROM nodes WHERE enabled = 1').all();

  const nodes: ProxyNode[] = (rows.results ?? []).map((row) =>
    parseNodeRow(row as Parameters<typeof parseNodeRow>[0]),
  );

  const configs = nodes.map((node) => {
    const adapter = getProtocolAdapter(node.protocol);
    return {
      nodeId: node.id,
      nodeName: node.name,
      protocol: node.protocol,
      health: node.health,
      config: adapter.generateClientConfig(
        node,
        {
          uuid: user.credentialUuid,
          trojanPassword: user.trojanPassword,
          ssPassword: user.ssPassword,
        },
        node.name,
      ),
    };
  });

  return jsonOk({ configs });
});

/** عملیات گروهی روی چند کاربر. */
usersRouter.post('/bulk', requirePermission('users.write'), async (c) => {
  const input = await parseJson(c, userBulkSchema);
  const auth = c.get('auth');

  if (input.action === 'delete' && !auth?.permissions.includes('users.delete')) {
    throw new AfraError('FORBIDDEN', 403, { required: 'users.delete' });
  }

  let affected = 0;
  for (const id of input.ids) {
    switch (input.action) {
      case 'enable':
        await setEnabled(c.env, id, true);
        affected += 1;
        break;
      case 'disable':
        await setEnabled(c.env, id, false);
        affected += 1;
        break;
      case 'delete':
        if (await deleteUser(c.env, id)) affected += 1;
        break;
      case 'reset-traffic':
        await resetTraffic(c.env, id);
        affected += 1;
        break;
      case 'extend':
        if (await extendUser(c.env, id, input.extendDays ?? 30)) affected += 1;
        break;
      case 'rotate-token': {
        const result = await c.env.AFRA_DB.prepare(
          'UPDATE subscriptions SET token = ?, rotated_at = ? WHERE user_id = ?',
        )
          .bind(newToken(32), nowIso(), id)
          .run();
        if ((result.meta.changes ?? 0) > 0) affected += 1;
        break;
      }
      default:
        break;
    }
  }

  await writeAudit(c.env, {
    adminId: auth?.adminId,
    adminUsername: auth?.username,
    action: `user.bulk.${input.action}`,
    resource: 'user',
    ip: c.get('clientIp'),
    metadata: { count: input.ids.length, affected },
  });

  return jsonOk({ affected });
});
