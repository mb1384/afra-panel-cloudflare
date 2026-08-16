import { AfraError, dnsServerSchema, dnsServerToUri, domainFilterSchema } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { rowToDnsServer, safeJson } from '../../db/mappers.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { checkDnsServers } from '../health/health.service.js';

export const dnsRouter = new Hono<AppEnv>();
dnsRouter.use('*', requireAuth);

dnsRouter.get('/servers', requirePermission('dns.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT * FROM dns_servers ORDER BY is_primary DESC, name',
  ).all<Parameters<typeof rowToDnsServer>[0]>();
  const items = (rows.results ?? []).map(rowToDnsServer);
  return jsonOk({
    items: items.map((server) => ({ ...server, uri: dnsServerToUri(server) })),
  });
});

dnsRouter.post('/servers', requirePermission('dns.write'), async (c) => {
  const input = await parseJson(c, dnsServerSchema);
  const id = newId('dns');

  if (input.isPrimary) {
    await c.env.AFRA_DB.prepare('UPDATE dns_servers SET is_primary = 0').run();
  }

  await c.env.AFRA_DB.prepare(
    `INSERT INTO dns_servers (id, name, kind, address, is_primary, is_fallback, enabled, supports_ipv6, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      input.kind,
      input.address.trim(),
      input.isPrimary ? 1 : 0,
      input.isFallback ? 1 : 0,
      input.enabled ? 1 : 0,
      input.supportsIpv6 ? 1 : 0,
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'dns.server.created',
    resource: 'dns_server',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { kind: input.kind },
  });
  return jsonOk({ id }, 201);
});

dnsRouter.patch('/servers/:id', requirePermission('dns.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, dnsServerSchema.partial());
  const existingRow = await c.env.AFRA_DB.prepare('SELECT * FROM dns_servers WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof rowToDnsServer>[0]>();
  if (!existingRow) throw new AfraError('NOT_FOUND', 404);
  const existing = rowToDnsServer(existingRow);

  if (input.isPrimary) {
    await c.env.AFRA_DB.prepare('UPDATE dns_servers SET is_primary = 0').run();
  }

  await c.env.AFRA_DB.prepare(
    `UPDATE dns_servers SET name = ?, kind = ?, address = ?, is_primary = ?, is_fallback = ?,
                            enabled = ?, supports_ipv6 = ?
      WHERE id = ?`,
  )
    .bind(
      input.name ?? existing.name,
      input.kind ?? existing.kind,
      (input.address ?? existing.address).trim(),
      (input.isPrimary ?? existing.isPrimary) ? 1 : 0,
      (input.isFallback ?? existing.isFallback) ? 1 : 0,
      (input.enabled ?? existing.enabled) ? 1 : 0,
      (input.supportsIpv6 ?? existing.supportsIpv6) ? 1 : 0,
      id,
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'dns.server.updated',
    resource: 'dns_server',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ updated: true });
});

dnsRouter.delete('/servers/:id', requirePermission('dns.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM dns_servers WHERE id = ?').bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'dns.server.deleted',
    resource: 'dns_server',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

/** بررسی سلامت واقعی سرورهای DNS پیکربندی‌شده. */
dnsRouter.post('/servers/check', requirePermission('dns.read'), async (c) => {
  const settings = await c.get('settings').load();
  const checked = await checkDnsServers(c.env, settings.healthCheckTimeoutMs);
  return jsonOk({ checked });
});

/* ------------------------------ فیلترینگ دامنه ------------------------------ */

dnsRouter.get('/filters', requirePermission('dns.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT id, name, kind, entry_count, enabled, created_at, updated_at FROM domain_filters ORDER BY created_at DESC',
  ).all<{
    id: string;
    name: string;
    kind: string;
    entry_count: number;
    enabled: number;
    created_at: string;
    updated_at: string;
  }>();
  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      entryCount: row.entry_count,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

dnsRouter.get('/filters/:id', requirePermission('dns.read'), async (c) => {
  const id = requireParam(c, 'id');
  const row = await c.env.AFRA_DB.prepare('SELECT * FROM domain_filters WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; kind: string; entries: string; enabled: number }>();
  if (!row) throw new AfraError('NOT_FOUND', 404);
  return jsonOk({
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled === 1,
    entries: safeJson<string[]>(row.entries, []),
  });
});

dnsRouter.post('/filters', requirePermission('dns.write'), async (c) => {
  const input = await parseJson(c, domainFilterSchema);
  const id = newId('flt');
  const entries = [...new Set(input.entries.map((entry) => entry.trim().toLowerCase()))].filter(
    Boolean,
  );
  await c.env.AFRA_DB.prepare(
    `INSERT INTO domain_filters (id, name, kind, entries, entry_count, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      input.kind,
      JSON.stringify(entries),
      entries.length,
      input.enabled ? 1 : 0,
      nowIso(),
      nowIso(),
    )
    .run();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'dns.filter.created',
    resource: 'domain_filter',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { kind: input.kind, entries: entries.length },
  });
  return jsonOk({ id, entryCount: entries.length }, 201);
});

dnsRouter.patch('/filters/:id', requirePermission('dns.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, domainFilterSchema.partial());
  const row = await c.env.AFRA_DB.prepare('SELECT * FROM domain_filters WHERE id = ?')
    .bind(id)
    .first<{ name: string; kind: string; entries: string; enabled: number }>();
  if (!row) throw new AfraError('NOT_FOUND', 404);

  const entries = input.entries
    ? [...new Set(input.entries.map((entry) => entry.trim().toLowerCase()))].filter(Boolean)
    : safeJson<string[]>(row.entries, []);

  await c.env.AFRA_DB.prepare(
    'UPDATE domain_filters SET name = ?, kind = ?, entries = ?, entry_count = ?, enabled = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      input.name ?? row.name,
      input.kind ?? row.kind,
      JSON.stringify(entries),
      entries.length,
      (input.enabled ?? row.enabled === 1) ? 1 : 0,
      nowIso(),
      id,
    )
    .run();
  return jsonOk({ updated: true, entryCount: entries.length });
});

dnsRouter.delete('/filters/:id', requirePermission('dns.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM domain_filters WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  return jsonOk({ deleted: true });
});
