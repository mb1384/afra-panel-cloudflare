import { countryCodeToFlag, getProtocolAdapter, parseNodeRow } from '@afra/shared';
import type { NodeCreateInput, NodeUpdateInput, ProxyNode } from '@afra/shared';
import { AfraError } from '@afra/shared';
import type { Bindings } from '../../core/env.js';
import { newId, nowIso } from '../../core/ids.js';
import { likePattern } from '../../db/mappers.js';

type NodeRow = Parameters<typeof parseNodeRow>[0];

export interface NodeListFilters {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order: 'asc' | 'desc';
  health: string;
  kind: string;
  protocol: string;
}

const SORTABLE: Record<string, string> = {
  createdAt: 'created_at',
  name: 'name',
  latency: 'latency_ms',
  priority: 'priority',
  weight: 'weight',
};

export async function listNodes(
  env: Bindings,
  filters: NodeListFilters,
): Promise<{ items: ProxyNode[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push("(name LIKE ? ESCAPE '\\' OR hostname LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filters.health !== 'all') {
    conditions.push('health = ?');
    params.push(filters.health);
  }
  if (filters.kind !== 'all') {
    conditions.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.protocol !== 'all') {
    conditions.push('protocol = ?');
    params.push(filters.protocol);
  }

  const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const orderColumn = SORTABLE[filters.sort ?? 'createdAt'] ?? 'created_at';
  const orderDir = filters.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (filters.page - 1) * filters.pageSize;

  const rows = await env.AFRA_DB.prepare(
    `SELECT * FROM nodes${whereSql} ORDER BY ${orderColumn} ${orderDir} LIMIT ? OFFSET ?`,
  )
    .bind(...params, filters.pageSize, offset)
    .all<NodeRow>();

  const count = await env.AFRA_DB.prepare(`SELECT COUNT(*) AS total FROM nodes${whereSql}`)
    .bind(...params)
    .first<{ total: number }>();

  return {
    items: (rows.results ?? []).map(parseNodeRow),
    total: count?.total ?? 0,
  };
}

export async function getNode(env: Bindings, id: string): Promise<ProxyNode | null> {
  const row = await env.AFRA_DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(id)
    .first<NodeRow>();
  return row ? parseNodeRow(row) : null;
}

function toDraftNode(id: string, input: NodeCreateInput): ProxyNode {
  const country = input.country ? input.country.toUpperCase() : null;
  return {
    id,
    name: input.name,
    kind: input.kind,
    country,
    city: input.city ?? null,
    flag: input.flag || (country ? countryCodeToFlag(country) : null),
    hostname: input.hostname,
    ip: input.ip ?? null,
    port: input.port,
    protocol: input.protocol,
    transport: {
      kind: input.transport.kind,
      path: input.transport.path ?? null,
      host: input.transport.host ?? null,
      serviceName: input.transport.serviceName ?? null,
      mode: input.transport.mode ?? null,
    },
    tls: {
      mode: input.tls.mode,
      sni: input.tls.sni ?? null,
      alpn: input.tls.alpn ?? null,
      fingerprint: input.tls.fingerprint ?? null,
      minVersion: input.tls.minVersion ?? null,
      allowInsecure: input.tls.allowInsecure ?? false,
    },
    cfWorkerName: input.cfWorkerName ?? null,
    cfRouteHost: input.cfRouteHost ?? null,
    priority: input.priority,
    weight: input.weight,
    enabled: input.enabled,
    health: 'unknown',
    latencyMs: null,
    lastCheckAt: null,
    successCount: 0,
    failureCount: 0,
    notes: input.notes ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/** اعتبارسنجی Node با adapter پروتکل مربوطه. خطا با جزئیات فارسی برگردانده می‌شود. */
export function validateNode(node: ProxyNode): void {
  const adapter = getProtocolAdapter(node.protocol);
  const result = adapter.validate(node);
  if (!result.valid) {
    throw new AfraError('VALIDATION_ERROR', 422, { issues: result.issues });
  }
}

export async function createNode(env: Bindings, input: NodeCreateInput): Promise<ProxyNode> {
  const id = newId('nod');
  const draft = toDraftNode(id, input);
  validateNode(draft);

  await env.AFRA_DB.prepare(
    `INSERT INTO nodes (id, name, kind, country, city, flag, hostname, ip, port, protocol,
                        transport_json, tls_json, cf_worker_name, cf_route_host, priority, weight,
                        enabled, health, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
  )
    .bind(
      draft.id,
      draft.name,
      draft.kind,
      draft.country,
      draft.city,
      draft.flag,
      draft.hostname,
      draft.ip,
      draft.port,
      draft.protocol,
      JSON.stringify(draft.transport),
      JSON.stringify(draft.tls),
      draft.cfWorkerName,
      draft.cfRouteHost,
      draft.priority,
      draft.weight,
      draft.enabled ? 1 : 0,
      draft.notes,
      draft.createdAt,
      draft.updatedAt,
    )
    .run();

  return draft;
}

export async function updateNode(
  env: Bindings,
  id: string,
  input: NodeUpdateInput,
): Promise<ProxyNode | null> {
  const existing = await getNode(env, id);
  if (!existing) return null;

  const merged: ProxyNode = {
    ...existing,
    name: input.name ?? existing.name,
    kind: input.kind ?? existing.kind,
    country: input.country !== undefined ? (input.country || null) : existing.country,
    city: input.city !== undefined ? (input.city ?? null) : existing.city,
    hostname: input.hostname ?? existing.hostname,
    ip: input.ip !== undefined ? (input.ip ?? null) : existing.ip,
    port: input.port ?? existing.port,
    protocol: input.protocol ?? existing.protocol,
    transport: input.transport
      ? {
          kind: input.transport.kind,
          path: input.transport.path ?? null,
          host: input.transport.host ?? null,
          serviceName: input.transport.serviceName ?? null,
          mode: input.transport.mode ?? null,
        }
      : existing.transport,
    tls: input.tls
      ? {
          mode: input.tls.mode,
          sni: input.tls.sni ?? null,
          alpn: input.tls.alpn ?? null,
          fingerprint: input.tls.fingerprint ?? null,
          minVersion: input.tls.minVersion ?? null,
          allowInsecure: input.tls.allowInsecure ?? false,
        }
      : existing.tls,
    cfWorkerName:
      input.cfWorkerName !== undefined ? (input.cfWorkerName ?? null) : existing.cfWorkerName,
    cfRouteHost: input.cfRouteHost !== undefined ? (input.cfRouteHost ?? null) : existing.cfRouteHost,
    priority: input.priority ?? existing.priority,
    weight: input.weight ?? existing.weight,
    enabled: input.enabled ?? existing.enabled,
    notes: input.notes !== undefined ? (input.notes ?? null) : existing.notes,
    updatedAt: nowIso(),
  };
  merged.flag =
    input.flag !== undefined
      ? input.flag || (merged.country ? countryCodeToFlag(merged.country) : null)
      : merged.country
        ? countryCodeToFlag(merged.country)
        : existing.flag;

  validateNode(merged);

  await env.AFRA_DB.prepare(
    `UPDATE nodes SET name = ?, kind = ?, country = ?, city = ?, flag = ?, hostname = ?, ip = ?,
                      port = ?, protocol = ?, transport_json = ?, tls_json = ?, cf_worker_name = ?,
                      cf_route_host = ?, priority = ?, weight = ?, enabled = ?, notes = ?,
                      health = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      merged.name,
      merged.kind,
      merged.country,
      merged.city,
      merged.flag,
      merged.hostname,
      merged.ip,
      merged.port,
      merged.protocol,
      JSON.stringify(merged.transport),
      JSON.stringify(merged.tls),
      merged.cfWorkerName,
      merged.cfRouteHost,
      merged.priority,
      merged.weight,
      merged.enabled ? 1 : 0,
      merged.notes,
      merged.enabled ? merged.health : 'disabled',
      merged.updatedAt,
      id,
    )
    .run();

  return getNode(env, id);
}

export async function deleteNode(env: Bindings, id: string): Promise<boolean> {
  const result = await env.AFRA_DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
