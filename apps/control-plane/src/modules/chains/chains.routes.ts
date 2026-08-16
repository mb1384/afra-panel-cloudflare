import { AfraError, proxyChainSchema } from '@afra/shared';
import type { ChainHop } from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import type { Bindings } from '../../core/env.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { rowToChain } from '../../db/mappers.js';
import { parseJson, requireParam } from '../../core/validate.js';

export const chainsRouter = new Hono<AppEnv>();
chainsRouter.use('*', requireAuth);

export interface ChainValidationIssue {
  index: number;
  message: string;
}

/** اعتبارسنجی زنجیره پیش از ذخیره: وجود Node، یکتایی گام‌ها و کامل بودن اطلاعات. */
export async function validateChain(
  env: Bindings,
  hops: ChainHop[],
): Promise<ChainValidationIssue[]> {
  const issues: ChainValidationIssue[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index];
    if (hop.kind === 'node') {
      if (!hop.nodeId) {
        issues.push({ index, message: 'شناسهٔ سرور برای این گام تعیین نشده است.' });
        continue;
      }
      const node = await env.AFRA_DB.prepare('SELECT id, enabled FROM nodes WHERE id = ?')
        .bind(hop.nodeId)
        .first<{ id: string; enabled: number }>();
      if (!node) {
        issues.push({ index, message: 'سرور انتخاب‌شده وجود ندارد.' });
      } else if (node.enabled !== 1) {
        issues.push({ index, message: 'سرور انتخاب‌شده غیرفعال است.' });
      }
      if (seen.has(`node:${hop.nodeId}`)) {
        issues.push({ index, message: 'این سرور بیش از یک بار در زنجیره تکرار شده است.' });
      }
      seen.add(`node:${hop.nodeId}`);
    } else {
      if (!hop.host || !hop.port) {
        issues.push({ index, message: 'میزبان و پورت برای گام بیرونی الزامی است.' });
        continue;
      }
      const key = `${hop.kind}:${hop.host}:${hop.port}`;
      if (seen.has(key)) issues.push({ index, message: 'این گام تکراری است.' });
      seen.add(key);
    }
  }

  if (hops.length < 2) {
    issues.push({ index: 0, message: 'زنجیره باید حداقل دو گام داشته باشد.' });
  }

  return issues;
}

chainsRouter.get('/', requirePermission('chains.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT * FROM proxy_chains ORDER BY created_at DESC',
  ).all<Parameters<typeof rowToChain>[0]>();
  return jsonOk({ items: (rows.results ?? []).map(rowToChain) });
});

chainsRouter.post('/validate', requirePermission('chains.read'), async (c) => {
  const input = await parseJson(c, proxyChainSchema);
  const issues = await validateChain(c.env, input.hops);
  return jsonOk({ valid: issues.length === 0, issues });
});

chainsRouter.post('/', requirePermission('chains.write'), async (c) => {
  const input = await parseJson(c, proxyChainSchema);
  const issues = await validateChain(c.env, input.hops);
  if (issues.length > 0) throw new AfraError('CHAIN_INVALID', 422, { issues });

  const id = newId('chn');
  await c.env.AFRA_DB.prepare(
    'INSERT INTO proxy_chains (id, name, hops_json, enabled, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      input.name,
      JSON.stringify(input.hops),
      input.enabled ? 1 : 0,
      input.notes ?? null,
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'chain.created',
    resource: 'proxy_chain',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { hops: input.hops.length },
  });
  return jsonOk({ id }, 201);
});

chainsRouter.patch('/:id', requirePermission('chains.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, proxyChainSchema.partial());
  const row = await c.env.AFRA_DB.prepare('SELECT * FROM proxy_chains WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof rowToChain>[0]>();
  if (!row) throw new AfraError('NOT_FOUND', 404);
  const existing = rowToChain(row);

  const hops = input.hops ?? existing.hops;
  const issues = await validateChain(c.env, hops);
  if (issues.length > 0) throw new AfraError('CHAIN_INVALID', 422, { issues });

  await c.env.AFRA_DB.prepare(
    'UPDATE proxy_chains SET name = ?, hops_json = ?, enabled = ?, notes = ? WHERE id = ?',
  )
    .bind(
      input.name ?? existing.name,
      JSON.stringify(hops),
      (input.enabled ?? existing.enabled) ? 1 : 0,
      input.notes !== undefined ? (input.notes ?? null) : existing.notes,
      id,
    )
    .run();
  return jsonOk({ updated: true });
});

chainsRouter.delete('/:id', requirePermission('chains.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM proxy_chains WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'chain.deleted',
    resource: 'proxy_chain',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});
