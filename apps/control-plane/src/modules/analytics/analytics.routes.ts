import { analyticsQuerySchema } from '@afra/shared';
import type { DashboardStats, Environment } from '@afra/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../core/context.js';
import { nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseQuery } from '../../core/validate.js';
import { resolveCloudflareCredentials } from '../../cloudflare/resolve.js';
import { resolveBotToken } from '../telegram/telegram.service.js';

export const analyticsRouter = new Hono<AppEnv>();
analyticsRouter.use('*', requireAuth);

/** آمار داشبورد — همهٔ مقادیر از دیتابیس واقعی خوانده می‌شوند. */
analyticsRouter.get('/overview', requirePermission('analytics.read'), async (c) => {
  const now = nowIso();
  const settings = c.get('settings');
  const config = await settings.load();

  const [userStats, trafficStats, nodeStats, backendStats, dnsStats] = await Promise.all([
    c.env.AFRA_DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN enabled = 1 AND (expires_at IS NULL OR expires_at > ?1)
                   AND (quota_bytes IS NULL OR used_bytes < quota_bytes) THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ?1 THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) AS disabled
       FROM users`,
    )
      .bind(now)
      .first<{ total: number; active: number; expired: number; disabled: number }>(),
    c.env.AFRA_DB.prepare(
      `SELECT COALESCE(SUM(used_bytes), 0) AS used,
              COALESCE(SUM(CASE WHEN quota_bytes IS NULL THEN 0 ELSE quota_bytes END), 0) AS quota,
              SUM(CASE WHEN quota_bytes IS NULL THEN 1 ELSE 0 END) AS unlimited
         FROM users`,
    ).first<{ used: number; quota: number; unlimited: number }>(),
    c.env.AFRA_DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN health = 'healthy' THEN 1 ELSE 0 END) AS healthy,
              SUM(CASE WHEN health = 'degraded' THEN 1 ELSE 0 END) AS degraded,
              SUM(CASE WHEN health = 'unreachable' THEN 1 ELSE 0 END) AS unreachable,
              AVG(latency_ms) AS avg_latency
         FROM nodes WHERE enabled = 1`,
    ).first<{
      total: number;
      healthy: number;
      degraded: number;
      unreachable: number;
      avg_latency: number | null;
    }>(),
    c.env.AFRA_DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN health = 'healthy' THEN 1 ELSE 0 END) AS healthy
         FROM backends WHERE enabled = 1`,
    ).first<{ total: number; healthy: number }>(),
    c.env.AFRA_DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN health = 'healthy' THEN 1 ELSE 0 END) AS healthy
         FROM dns_servers WHERE enabled = 1`,
    ).first<{ total: number; healthy: number }>(),
  ]);

  const cloudflare = await resolveCloudflareCredentials(c.env, settings);
  const botToken = await resolveBotToken(c.env, settings);

  const stats: DashboardStats = {
    users: {
      total: userStats?.total ?? 0,
      active: userStats?.active ?? 0,
      expired: userStats?.expired ?? 0,
      disabled: userStats?.disabled ?? 0,
    },
    traffic: {
      usedBytes: trafficStats?.used ?? 0,
      quotaBytes: trafficStats?.quota ?? 0,
      remainingBytes:
        (trafficStats?.unlimited ?? 0) > 0
          ? null
          : Math.max((trafficStats?.quota ?? 0) - (trafficStats?.used ?? 0), 0),
    },
    nodes: {
      total: nodeStats?.total ?? 0,
      healthy: nodeStats?.healthy ?? 0,
      degraded: nodeStats?.degraded ?? 0,
      unreachable: nodeStats?.unreachable ?? 0,
      avgLatencyMs:
        nodeStats?.avg_latency === null || nodeStats?.avg_latency === undefined
          ? null
          : Math.round(nodeStats.avg_latency),
    },
    backend: { total: backendStats?.total ?? 0, healthy: backendStats?.healthy ?? 0 },
    dns: { total: dnsStats?.total ?? 0, healthy: dnsStats?.healthy ?? 0 },
    telegram: { configured: Boolean(botToken), healthy: config.telegramEnabled && Boolean(botToken) },
    cloudflare: {
      configured: Boolean(cloudflare),
      healthy: Boolean(cloudflare),
      accountId: cloudflare?.accountId ?? null,
    },
    system: {
      environment: (c.env.AFRA_ENV as Environment) ?? 'development',
      version: c.env.AFRA_VERSION,
      time: now,
    },
  };

  const recentEvents = await c.env.AFRA_DB.prepare(
    'SELECT action, resource, result, admin_username, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10',
  ).all<{
    action: string;
    resource: string | null;
    result: string;
    admin_username: string | null;
    created_at: string;
  }>();

  const recentUsers = await c.env.AFRA_DB.prepare(
    'SELECT id, name, username, enabled, used_bytes, quota_bytes, expires_at, created_at FROM users ORDER BY created_at DESC LIMIT 5',
  ).all<{
    id: string;
    name: string;
    username: string;
    enabled: number;
    used_bytes: number;
    quota_bytes: number | null;
    expires_at: string | null;
    created_at: string;
  }>();

  return jsonOk({
    stats,
    recentEvents: (recentEvents.results ?? []).map((row) => ({
      action: row.action,
      resource: row.resource,
      result: row.result,
      adminUsername: row.admin_username,
      createdAt: row.created_at,
    })),
    recentUsers: (recentUsers.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      enabled: row.enabled === 1,
      usedBytes: row.used_bytes,
      quotaBytes: row.quota_bytes,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  });
});

/** سری زمانی ترافیک از جدول نمونه‌های واقعی. */
analyticsRouter.get('/traffic', requirePermission('analytics.read'), async (c) => {
  const query = parseQuery(c, analyticsQuerySchema);
  const hours = query.range === '24h' ? 24 : query.range === '7d' ? 24 * 7 : 24 * 30;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const rows = await c.env.AFRA_DB.prepare(
    `SELECT bucket_at, SUM(bytes) AS bytes
       FROM traffic_samples
      WHERE bucket_at >= ?
      GROUP BY bucket_at
      ORDER BY bucket_at`,
  )
    .bind(since)
    .all<{ bucket_at: string; bytes: number }>();

  const topUsers = await c.env.AFRA_DB.prepare(
    `SELECT u.username, u.name, SUM(t.bytes) AS bytes
       FROM traffic_samples t JOIN users u ON u.id = t.user_id
      WHERE t.bucket_at >= ?
      GROUP BY t.user_id
      ORDER BY bytes DESC
      LIMIT 10`,
  )
    .bind(since)
    .all<{ username: string; name: string; bytes: number }>();

  return jsonOk({
    range: query.range,
    series: (rows.results ?? []).map((row) => ({ at: row.bucket_at, bytes: row.bytes })),
    topUsers: (topUsers.results ?? []).map((row) => ({
      username: row.username,
      name: row.name,
      bytes: row.bytes,
    })),
  });
});

/** سری زمانی سلامت سرورها. */
analyticsRouter.get('/node-health', requirePermission('analytics.read'), async (c) => {
  const query = parseQuery(c, analyticsQuerySchema);
  const hours = query.range === '24h' ? 24 : query.range === '7d' ? 24 * 7 : 24 * 30;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const rows = await c.env.AFRA_DB.prepare(
    `SELECT substr(checked_at, 1, 13) AS hour,
            SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_count,
            SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fail_count,
            AVG(latency_ms) AS avg_latency
       FROM node_health_checks
      WHERE checked_at >= ?
      GROUP BY hour
      ORDER BY hour`,
  )
    .bind(since)
    .all<{ hour: string; ok_count: number; fail_count: number; avg_latency: number | null }>();

  return jsonOk({
    range: query.range,
    series: (rows.results ?? []).map((row) => ({
      at: `${row.hour}:00:00Z`,
      ok: row.ok_count,
      failed: row.fail_count,
      avgLatencyMs: row.avg_latency === null ? null : Math.round(row.avg_latency),
    })),
  });
});
