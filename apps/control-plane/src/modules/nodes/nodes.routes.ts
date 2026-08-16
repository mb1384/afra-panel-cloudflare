import {
  AfraError,
  DEFAULT_NODE_TEMPLATE,
  TEMPLATE_VARIABLES,
  TRANSPORT_LABELS_FA,
  getProtocolAdapter,
  listProtocolMetadata,
  nodeCreateSchema,
  nodeQuerySchema,
  nodeUpdateSchema,
  rankCandidates,
  renderNodeName,
  toCandidate,
} from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseJson, parseQuery, requireParam } from '../../core/validate.js';
import { runHealthChecks } from '../health/health.service.js';
import { createNode, deleteNode, getNode, listNodes, updateNode } from './nodes.service.js';

export const nodesRouter = new Hono<AppEnv>();
nodesRouter.use('*', requireAuth);

/** فراداده پروتکل‌ها و transportها برای ساخت فرم‌های پویا در رابط کاربری. */
nodesRouter.get('/meta', requirePermission('nodes.read'), (_c) =>
  jsonOk({
    protocols: listProtocolMetadata(),
    transports: Object.entries(TRANSPORT_LABELS_FA).map(([key, labelFa]) => ({ key, labelFa })),
    templateVariables: TEMPLATE_VARIABLES,
    defaultTemplate: DEFAULT_NODE_TEMPLATE,
  }),
);

nodesRouter.get('/', requirePermission('nodes.read'), async (c) => {
  const query = parseQuery(c, nodeQuerySchema);
  const { items, total } = await listNodes(c.env, query);
  const settings = await c.get('settings').load();

  return jsonOk({
    items: items.map((node, index) => ({
      ...node,
      displayName: renderNodeName(settings.nodeNameTemplate, {
        name: node.name,
        country: node.country,
        city: node.city,
        flag: node.flag,
        protocol: node.protocol,
        index: index + 1,
      }),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  });
});

/** ترتیب انتخاب Nodeها بر اساس استراتژی توازن بار فعلی. */
nodesRouter.get('/balance-preview', requirePermission('nodes.read'), async (c) => {
  const settings = await c.get('settings').load();
  const { items } = await listNodes(c.env, {
    page: 1,
    pageSize: 200,
    order: 'desc',
    health: 'all',
    kind: 'all',
    protocol: 'all',
  });
  const ranked = rankCandidates(items.map(toCandidate), settings.balanceStrategy);
  const byId = new Map(items.map((node) => [node.id, node]));
  return jsonOk({
    strategy: settings.balanceStrategy,
    failoverEnabled: settings.failoverEnabled,
    order: ranked.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.id,
      name: byId.get(candidate.id)?.name ?? candidate.id,
      priority: candidate.priority,
      weight: candidate.weight,
      health: candidate.health,
      latencyMs: candidate.latencyMs,
    })),
  });
});

nodesRouter.post('/', requirePermission('nodes.write'), async (c) => {
  const input = await parseJson(c, nodeCreateSchema);
  const node = await createNode(c.env, input);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'node.created',
    resource: 'node',
    resourceId: node.id,
    ip: c.get('clientIp'),
    metadata: { name: node.name, hostname: node.hostname, protocol: node.protocol },
  });
  return jsonOk({ node }, 201);
});

nodesRouter.get('/:id', requirePermission('nodes.read'), async (c) => {
  const node = await getNode(c.env, requireParam(c, 'id'));
  if (!node) throw new AfraError('NODE_NOT_FOUND', 404);

  const history = await c.env.AFRA_DB.prepare(
    'SELECT ok, latency_ms, state, error, checked_at FROM node_health_checks WHERE node_id = ? ORDER BY checked_at DESC LIMIT 50',
  )
    .bind(node.id)
    .all<{
      ok: number;
      latency_ms: number | null;
      state: string;
      error: string | null;
      checked_at: string;
    }>();

  const assignedUsers = await c.env.AFRA_DB.prepare(
    'SELECT COUNT(*) AS total FROM user_nodes WHERE node_id = ?',
  )
    .bind(node.id)
    .first<{ total: number }>();

  return jsonOk({
    node,
    assignedUsers: assignedUsers?.total ?? 0,
    validation: getProtocolAdapter(node.protocol).validate(node),
    history: (history.results ?? []).map((row) => ({
      ok: row.ok === 1,
      latencyMs: row.latency_ms,
      state: row.state,
      error: row.error,
      checkedAt: row.checked_at,
    })),
  });
});

nodesRouter.patch('/:id', requirePermission('nodes.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, nodeUpdateSchema);
  const node = await updateNode(c.env, id, input);
  if (!node) throw new AfraError('NODE_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'node.updated',
    resource: 'node',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { fields: Object.keys(input) },
  });
  return jsonOk({ node });
});

nodesRouter.delete('/:id', requirePermission('nodes.delete'), async (c) => {
  const id = requireParam(c, 'id');
  const deleted = await deleteNode(c.env, id);
  if (!deleted) throw new AfraError('NODE_NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'node.deleted',
    resource: 'node',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

/** بررسی سلامت یک Node مشخص (اتصال واقعی TCP/TLS). */
nodesRouter.post('/:id/check', requirePermission('nodes.read'), async (c) => {
  const id = requireParam(c, 'id');
  const node = await getNode(c.env, id);
  if (!node) throw new AfraError('NODE_NOT_FOUND', 404);
  const result = await runHealthChecks(c.env, c.get('settings'), { nodeIds: [id] });
  return jsonOk({ result, node: await getNode(c.env, id) });
});

/** بررسی سلامت همهٔ Nodeهای فعال. */
nodesRouter.post('/check-all', requirePermission('nodes.read'), async (c) => {
  const result = await runHealthChecks(c.env, c.get('settings'));
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'node.health.checked',
    resource: 'node',
    ip: c.get('clientIp'),
  });
  return jsonOk({ result });
});
