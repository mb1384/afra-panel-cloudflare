import { parseNodeRow } from '@afra/shared';
import type { HealthState, ProxyNode } from '@afra/shared';
import type { Bindings } from '../../core/env.js';
import { newId, nowIso } from '../../core/ids.js';
import type { AfraSettings, SettingsService } from '../../core/settings.js';
import type { HealthOutcome, HealthTarget, RunSummary } from '../../durable/health-coordinator.js';
import { notify } from '../notifications/notifications.service.js';

const HEALTH_LABELS_FA: Record<HealthState, string> = {
  healthy: 'سالم',
  degraded: 'کند',
  unreachable: 'خارج از دسترس',
  disabled: 'غیرفعال',
  unknown: 'نامشخص',
};

export function nodeToTarget(node: ProxyNode): HealthTarget {
  return {
    id: node.id,
    hostname: node.hostname,
    port: node.port,
    useTls: node.tls.mode === 'tls',
  };
}

/**
 * اجرای یک چرخهٔ بررسی سلامت.
 * بررسی فقط روی Nodeهایی انجام می‌شود که مدیر صریحاً پیکربندی کرده است.
 */
export async function runHealthChecks(
  env: Bindings,
  settings: SettingsService,
  options: { nodeIds?: string[] } = {},
): Promise<RunSummary | { skipped: true; reason: string }> {
  const config: AfraSettings = await settings.load();

  const rows =
    options.nodeIds && options.nodeIds.length > 0
      ? await env.AFRA_DB.prepare(
          `SELECT * FROM nodes WHERE id IN (${options.nodeIds.map(() => '?').join(',')})`,
        )
          .bind(...options.nodeIds)
          .all()
      : await env.AFRA_DB.prepare('SELECT * FROM nodes WHERE enabled = 1').all();

  const nodes = (rows.results ?? []).map((row) =>
    parseNodeRow(row as Parameters<typeof parseNodeRow>[0]),
  );
  if (nodes.length === 0) {
    return { skipped: true, reason: 'no_nodes' };
  }

  const stub = env.HEALTH_COORDINATOR.get(env.HEALTH_COORDINATOR.idFromName('global'));
  const response = await stub.fetch('https://afra.internal/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: nodes.map(nodeToTarget),
      timeoutMs: config.healthCheckTimeoutMs,
      degradedThresholdMs: config.degradedLatencyMs,
      concurrency: 6,
    }),
  });

  if (response.status === 409) {
    return { skipped: true, reason: 'already_running' };
  }
  if (!response.ok) {
    return { skipped: true, reason: `coordinator_error_${response.status}` };
  }

  const summary = (await response.json()) as RunSummary;
  await applyOutcomes(env, settings, nodes, summary.outcomes);
  return summary;
}

async function applyOutcomes(
  env: Bindings,
  settings: SettingsService,
  nodes: ProxyNode[],
  outcomes: HealthOutcome[],
): Promise<void> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const statements = [];
  const timestamp = nowIso();

  for (const outcome of outcomes) {
    const node = byId.get(outcome.id);
    if (!node) continue;

    statements.push(
      env.AFRA_DB.prepare(
        `UPDATE nodes
            SET health = ?, latency_ms = ?, last_check_at = ?,
                success_count = success_count + ?, failure_count = failure_count + ?,
                updated_at = ?
          WHERE id = ?`,
      ).bind(
        outcome.state,
        outcome.latencyMs,
        timestamp,
        outcome.ok ? 1 : 0,
        outcome.ok ? 0 : 1,
        timestamp,
        outcome.id,
      ),
      env.AFRA_DB.prepare(
        `INSERT INTO node_health_checks (id, node_id, ok, latency_ms, state, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId('hc'),
        outcome.id,
        outcome.ok ? 1 : 0,
        outcome.latencyMs,
        outcome.state,
        outcome.error,
        timestamp,
      ),
    );
  }

  if (statements.length > 0) await env.AFRA_DB.batch(statements);

  // اعلان فقط در لحظهٔ تغییر وضعیت (بدون تکرار مزاحم)
  for (const outcome of outcomes) {
    const node = byId.get(outcome.id);
    if (!node) continue;
    if (node.health === outcome.state) continue;

    if (outcome.state === 'unreachable') {
      await notify(env, settings, {
        type: 'node.down',
        severity: 'error',
        title: `سرور «${node.name}» خارج از دسترس شد`,
        body: `میزبان ${node.hostname}:${node.port} پاسخ نداد. علت: ${outcome.error ?? 'نامشخص'}`,
      });
    } else if (node.health === 'unreachable' && outcome.ok) {
      await notify(env, settings, {
        type: 'node.recovered',
        severity: 'info',
        title: `سرور «${node.name}» بازیابی شد`,
        body: `وضعیت جدید: ${HEALTH_LABELS_FA[outcome.state]} — تأخیر ${outcome.latencyMs ?? '?'} میلی‌ثانیه`,
      });
    } else if (outcome.state === 'degraded') {
      await notify(env, settings, {
        type: 'node.degraded',
        severity: 'warning',
        title: `افت کیفیت سرور «${node.name}»`,
        body: `تأخیر ${outcome.latencyMs ?? '?'} میلی‌ثانیه بیش از آستانهٔ تعیین‌شده است.`,
      });
    }
  }
}

/** بررسی سلامت سرورهای DNS با یک پرس‌وجوی واقعی DoH. */
export async function checkDnsServers(env: Bindings, timeoutMs = 5000): Promise<number> {
  const rows = await env.AFRA_DB.prepare('SELECT id, kind, address FROM dns_servers WHERE enabled = 1').all<{
    id: string;
    kind: string;
    address: string;
  }>();

  let checked = 0;
  for (const row of rows.results ?? []) {
    const started = Date.now();
    let ok = false;
    if (row.kind === 'doh') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const base = row.address.startsWith('http') ? row.address : `https://${row.address}`;
        const response = await fetch(`${base}?name=example.com&type=A`, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        });
        ok = response.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
      }
    } else {
      // برای udp/dot در محیط Workers امکان پرس‌وجوی مستقیم نیست؛
      // فقط دسترسی‌پذیری TCP بررسی می‌شود.
      try {
        const { connect } = await import('cloudflare:sockets');
        const [host, portText] = row.address.replace(/^tls:\/\//, '').split(':');
        const socket = connect(
          { hostname: host, port: Number(portText) || (row.kind === 'dot' ? 853 : 53) },
          { secureTransport: row.kind === 'dot' ? 'on' : 'off', allowHalfOpen: false },
        );
        await socket.opened;
        await socket.close();
        ok = true;
      } catch {
        ok = false;
      }
    }

    const latency = ok ? Date.now() - started : null;
    await env.AFRA_DB.prepare(
      'UPDATE dns_servers SET health = ?, latency_ms = ?, last_check_at = ? WHERE id = ?',
    )
      .bind(ok ? 'healthy' : 'unreachable', latency, nowIso(), row.id)
      .run();
    checked += 1;
  }
  return checked;
}

/** بررسی سلامت بک‌اندها با فراخوانی endpoint سلامت آن‌ها. */
export async function checkBackends(env: Bindings, timeoutMs = 5000): Promise<number> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT id, url FROM backends WHERE enabled = 1',
  ).all<{ id: string; url: string }>();

  let checked = 0;
  for (const row of rows.results ?? []) {
    const started = Date.now();
    let ok = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(row.url);
      url.pathname = url.pathname.replace(/\/+$/, '') + '/health';
      const response = await fetch(url.toString(), { signal: controller.signal });
      ok = response.ok;
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    await env.AFRA_DB.prepare(
      'UPDATE backends SET health = ?, latency_ms = ?, last_check_at = ? WHERE id = ?',
    )
      .bind(ok ? 'healthy' : 'unreachable', ok ? Date.now() - started : null, nowIso(), row.id)
      .run();
    checked += 1;
  }
  return checked;
}

export { HEALTH_LABELS_FA };
