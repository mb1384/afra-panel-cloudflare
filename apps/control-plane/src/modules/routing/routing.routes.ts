import {
  AfraError,
  routingImportSchema,
  routingRuleSchema,
  toClashRules,
  validateRulePattern,
} from '@afra/shared';
import { Hono } from 'hono';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { rowToRoutingRule } from '../../db/mappers.js';
import { parseJson, requireParam } from '../../core/validate.js';

export const routingRouter = new Hono<AppEnv>();
routingRouter.use('*', requireAuth);

const SELECT = 'SELECT id, name, type, pattern, action, priority, enabled FROM routing_rules';

routingRouter.get('/rules', requirePermission('routing.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(`${SELECT} ORDER BY priority, name`).all<
    Parameters<typeof rowToRoutingRule>[0]
  >();
  const rules = (rows.results ?? []).map(rowToRoutingRule);
  const settings = await c.get('settings').load();
  return jsonOk({ items: rules, clashPreview: toClashRules(rules, settings.panelName) });
});

routingRouter.post('/rules', requirePermission('routing.write'), async (c) => {
  const input = await parseJson(c, routingRuleSchema);
  const patternError = validateRulePattern(input.type, input.pattern);
  if (patternError) {
    throw new AfraError('VALIDATION_ERROR', 422, { pattern: patternError });
  }

  const id = newId('rul');
  await c.env.AFRA_DB.prepare(
    'INSERT INTO routing_rules (id, name, type, pattern, action, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      input.name,
      input.type,
      input.pattern.trim(),
      input.action,
      input.priority,
      input.enabled ? 1 : 0,
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'routing.rule.created',
    resource: 'routing_rule',
    resourceId: id,
    ip: c.get('clientIp'),
    metadata: { type: input.type, action: input.action },
  });
  return jsonOk({ id }, 201);
});

routingRouter.patch('/rules/:id', requirePermission('routing.write'), async (c) => {
  const id = requireParam(c, 'id');
  const input = await parseJson(c, routingRuleSchema.partial());

  if (input.type && input.pattern) {
    const patternError = validateRulePattern(input.type, input.pattern);
    if (patternError) throw new AfraError('VALIDATION_ERROR', 422, { pattern: patternError });
  }

  const existing = await c.env.AFRA_DB.prepare(`${SELECT} WHERE id = ?`)
    .bind(id)
    .first<Parameters<typeof rowToRoutingRule>[0]>();
  if (!existing) throw new AfraError('NOT_FOUND', 404);
  const current = rowToRoutingRule(existing);

  await c.env.AFRA_DB.prepare(
    'UPDATE routing_rules SET name = ?, type = ?, pattern = ?, action = ?, priority = ?, enabled = ? WHERE id = ?',
  )
    .bind(
      input.name ?? current.name,
      input.type ?? current.type,
      (input.pattern ?? current.pattern).trim(),
      input.action ?? current.action,
      input.priority ?? current.priority,
      (input.enabled ?? current.enabled) ? 1 : 0,
      id,
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'routing.rule.updated',
    resource: 'routing_rule',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ updated: true });
});

routingRouter.delete('/rules/:id', requirePermission('routing.write'), async (c) => {
  const id = requireParam(c, 'id');
  const result = await c.env.AFRA_DB.prepare('DELETE FROM routing_rules WHERE id = ?')
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new AfraError('NOT_FOUND', 404);
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'routing.rule.deleted',
    resource: 'routing_rule',
    resourceId: id,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

routingRouter.get('/export', requirePermission('routing.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(`${SELECT} ORDER BY priority`).all<
    Parameters<typeof rowToRoutingRule>[0]
  >();
  return jsonOk({
    exportedAt: nowIso(),
    rules: (rows.results ?? []).map(rowToRoutingRule).map(({ id: _id, ...rule }) => rule),
  });
});

routingRouter.post('/import', requirePermission('routing.write'), async (c) => {
  const input = await parseJson(c, routingImportSchema);

  for (const rule of input.rules) {
    const patternError = validateRulePattern(rule.type, rule.pattern);
    if (patternError) {
      throw new AfraError('VALIDATION_ERROR', 422, { rule: rule.name, pattern: patternError });
    }
  }

  if (input.replace) {
    await c.env.AFRA_DB.prepare('DELETE FROM routing_rules').run();
  }

  await c.env.AFRA_DB.batch(
    input.rules.map((rule) =>
      c.env.AFRA_DB.prepare(
        'INSERT INTO routing_rules (id, name, type, pattern, action, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        newId('rul'),
        rule.name,
        rule.type,
        rule.pattern.trim(),
        rule.action,
        rule.priority,
        rule.enabled ? 1 : 0,
        nowIso(),
      ),
    ),
  );

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'routing.imported',
    resource: 'routing_rule',
    ip: c.get('clientIp'),
    metadata: { count: input.rules.length, replaced: input.replace },
  });
  return jsonOk({ imported: input.rules.length });
});
