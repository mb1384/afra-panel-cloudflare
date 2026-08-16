import { AfraError, backendSchema, warpSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { encryptSecret } from '../../core/crypto.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { rowToBackend, rowToWarp } from '../../db/mappers.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { checkBackends } from '../health/health.service.js';

export const backendsRouter = new Hono<AppEnv>();
backendsRouter.use('*', requireAuth);

/** توجه: مقدار secret هرگز برگردانده نمی‌شود؛ فقط وجود آن گزارش می‌گردد. */
backendsRouter.get('/', requirePermission('backends.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    `SELECT id, name, url, auth_type, enabled, is_fallback, health, latency_ms, last_check_at,
            CASE WHEN secret_enc IS NULL THEN 0 ELSE 1 END AS has_secret
       FROM backends ORDER BY created_at DESC`,
  ).all<Parameters<typeof rowToBackend>[0] & { has_secret: number }>();

  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      ...rowToBackend(row),
      hasSecret: row.has_secret === 1,
    })),
  });
});

backendsRouter.post('/', requirePermission('backends.write'), async (c) => {
  const input = await parseJson(c, backendSchema);
  const id = newId('bkd');
  const secretEnc =
    input.secret && input.secret.length > 0
      ? await encryptSecret(input.secret, c.env.AFRA_SECRET_KEY)
      : null;

  await c.env.AFRA_DB.prepare(
    `INSERT INTO backends (id, name, url, auth_type, secret_enc, enabled, is_fallback, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      input.url,
      input.authType,
      secretEnc,
      input.enabled ? 1 : 0,
      input.isFallback ? 1 : 0,
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'backend.created',
    resource: 'backend',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { url: input.url, authType: input.authType },
  });
  return jsonOk({ id }, 201);
});

backendsRouter.patch('/:id', requirePermission('backends.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, backendSchema.partial());
  const row = await c.env.AFRA_DB.prepare('SELECT * FROM backends WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof rowToBackend>[0]>();
  if (!row) throw new AfraError('NOT_FOUND', 404);
  const existing = rowToBackend(row);

  const secretEnc =
    input.secret === undefined
      ? undefined
      : input.secret
        ? await encryptSecret(input.secret, c.env.AFRA_SECRET_KEY)
        : null;

  await c.env.AFRA_DB.prepare(
    `UPDATE backends SET name = ?, url = ?, auth_type = ?, enabled = ?, is_fallback = ?
       ${secretEnc === undefined ? '' : ', secret_enc = ?'}
     WHERE id = ?`,
  )
    .bind(
      ...[
        input.name ?? existing.name,
        input.url ?? existing.url,
        input.authType ?? existing.authType,
        (input.enabled ?? existing.enabled) ? 1 : 0,
        (input.isFallback ?? existing.isFallback) ? 1 : 0,
        ...(secretEnc === undefined ? [] : [secretEnc]),
        id,
      ],
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'backend.updated',
    resource: 'backend',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { secretRotated: secretEnc !== undefined },
  });
  return jsonOk({ updated: true });
});

backendsRouter.delete('/:id', requirePermission('backends.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM backends WHERE id = ?').bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'backend.deleted',
    resource: 'backend',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

backendsRouter.post('/check', requirePermission('backends.read'), async (c) => {
  const settings = await c.get('settings').load();
  const checked = await checkBackends(c.env, settings.healthCheckTimeoutMs);
  return jsonOk({ checked });
});

/* ---------------------------------- WARP ---------------------------------- */

export const warpRouter = new Hono<AppEnv>();
warpRouter.use('*', requireAuth);

warpRouter.get('/', requirePermission('backends.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare('SELECT * FROM warp_configs ORDER BY created_at').all<
    Parameters<typeof rowToWarp>[0]
  >();
  return jsonOk({ items: (rows.results ?? []).map(rowToWarp) });
});

warpRouter.post('/', requirePermission('backends.write'), async (c) => {
  const input = await parseJson(c, warpSchema);
  const id = newId('wrp');
  await c.env.AFRA_DB.prepare(
    'INSERT INTO warp_configs (id, name, endpoint, enabled, route_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, input.name, input.endpoint, input.enabled ? 1 : 0, input.routeMode, nowIso())
    .run();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'warp.created',
    resource: 'warp',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ id }, 201);
});

warpRouter.patch('/:id', requirePermission('backends.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, warpSchema.partial());
  const row = await c.env.AFRA_DB.prepare('SELECT * FROM warp_configs WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof rowToWarp>[0]>();
  if (!row) throw new AfraError('NOT_FOUND', 404);
  const existing = rowToWarp(row);

  await c.env.AFRA_DB.prepare(
    'UPDATE warp_configs SET name = ?, endpoint = ?, enabled = ?, route_mode = ? WHERE id = ?',
  )
    .bind(
      input.name ?? existing.name,
      input.endpoint ?? existing.endpoint,
      (input.enabled ?? existing.enabled) ? 1 : 0,
      input.routeMode ?? existing.routeMode,
      id,
    )
    .run();
  return jsonOk({ updated: true });
});

warpRouter.delete('/:id', requirePermission('backends.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM warp_configs WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  return jsonOk({ deleted: true });
});

/** بررسی دسترسی‌پذیری endpoint واقعی WARP. */
warpRouter.post('/:id/check', requirePermission('backends.read'), async (c) => {
  const id = requireParam(c, 'id');
  const row = await c.env.AFRA_DB.prepare('SELECT endpoint FROM warp_configs WHERE id = ?')
    .bind(id)
    .first<{ endpoint: string }>();
  if (!row) throw new AfraError('NOT_FOUND', 404);

  const [host, portText] = row.endpoint.split(':');
  const port = Number(portText) || 443;
  const started = Date.now();
  let ok = false;
  try {
    const { connect } = await import('cloudflare:sockets');
    const socket = connect({ hostname: host, port }, { secureTransport: 'off', allowHalfOpen: false });
    await socket.opened;
    await socket.close();
    ok = true;
  } catch {
    ok = false;
  }

  await c.env.AFRA_DB.prepare(
    'UPDATE warp_configs SET health = ?, latency_ms = ?, last_check_at = ? WHERE id = ?',
  )
    .bind(ok ? 'healthy' : 'unreachable', ok ? Date.now() - started : null, nowIso(), id)
    .run();
  return jsonOk({ ok, latencyMs: ok ? Date.now() - started : null });
});
