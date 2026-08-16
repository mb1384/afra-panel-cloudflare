import { parseNodeRow } from '@afra/shared';
import type { DnsServerRecord, ProxyNode, RoutingRule, SubscriptionFormat } from '@afra/shared';
import type { EdgeBindings } from './env.js';

export interface SubscriptionLookup {
  subscriptionId: string;
  format: SubscriptionFormat;
  revokedAt: string | null;
  user: {
    id: string;
    name: string;
    username: string;
    credentialUuid: string;
    trojanPassword: string;
    ssPassword: string;
    enabled: boolean;
    quotaBytes: number | null;
    usedBytes: number;
    expiresAt: string | null;
  };
}

export async function findSubscriptionByToken(
  env: EdgeBindings,
  token: string,
): Promise<SubscriptionLookup | null> {
  const row = await env.AFRA_DB.prepare(
    `SELECT s.id AS subscription_id, s.format, s.revoked_at,
            u.id AS user_id, u.name, u.username, u.credential_uuid, u.trojan_password,
            u.ss_password, u.enabled, u.quota_bytes, u.used_bytes, u.expires_at
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
  )
    .bind(token)
    .first<{
      subscription_id: string;
      format: string;
      revoked_at: string | null;
      user_id: string;
      name: string;
      username: string;
      credential_uuid: string;
      trojan_password: string;
      ss_password: string;
      enabled: number;
      quota_bytes: number | null;
      used_bytes: number;
      expires_at: string | null;
    }>();

  if (!row) return null;

  return {
    subscriptionId: row.subscription_id,
    format: (row.format as SubscriptionFormat) ?? 'auto',
    revokedAt: row.revoked_at,
    user: {
      id: row.user_id,
      name: row.name,
      username: row.username,
      credentialUuid: row.credential_uuid,
      trojanPassword: row.trojan_password,
      ssPassword: row.ss_password,
      enabled: row.enabled === 1,
      quotaBytes: row.quota_bytes,
      usedBytes: row.used_bytes ?? 0,
      expiresAt: row.expires_at,
    },
  };
}

/** Nodeهای اختصاص‌یافته به کاربر؛ اگر تخصیصی وجود نداشته باشد همهٔ Nodeهای فعال. */
export async function findNodesForUser(env: EdgeBindings, userId: string): Promise<ProxyNode[]> {
  const assigned = await env.AFRA_DB.prepare(
    `SELECT n.* FROM nodes n
       JOIN user_nodes un ON un.node_id = n.id
      WHERE un.user_id = ? AND n.enabled = 1`,
  )
    .bind(userId)
    .all<Parameters<typeof parseNodeRow>[0]>();

  if ((assigned.results ?? []).length > 0) {
    return (assigned.results ?? []).map(parseNodeRow);
  }

  const all = await env.AFRA_DB.prepare('SELECT * FROM nodes WHERE enabled = 1').all<
    Parameters<typeof parseNodeRow>[0]
  >();
  return (all.results ?? []).map(parseNodeRow);
}

export async function findRoutingRules(env: EdgeBindings): Promise<RoutingRule[]> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT id, name, type, pattern, action, priority, enabled FROM routing_rules WHERE enabled = 1 ORDER BY priority',
  ).all<{
    id: string;
    name: string;
    type: string;
    pattern: string;
    action: string;
    priority: number;
    enabled: number;
  }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as RoutingRule['type'],
    pattern: row.pattern,
    action: row.action as RoutingRule['action'],
    priority: row.priority,
    enabled: row.enabled === 1,
  }));
}

export async function findDnsServers(env: EdgeBindings): Promise<DnsServerRecord[]> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT * FROM dns_servers WHERE enabled = 1 ORDER BY is_primary DESC',
  ).all<{
    id: string;
    name: string;
    kind: string;
    address: string;
    is_primary: number;
    is_fallback: number;
    enabled: number;
    supports_ipv6: number;
    health: string;
    latency_ms: number | null;
    last_check_at: string | null;
  }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as DnsServerRecord['kind'],
    address: row.address,
    isPrimary: row.is_primary === 1,
    isFallback: row.is_fallback === 1,
    enabled: row.enabled === 1,
    supportsIpv6: row.supports_ipv6 === 1,
    health: row.health as DnsServerRecord['health'],
    latencyMs: row.latency_ms,
    lastCheckAt: row.last_check_at,
  }));
}

export interface EdgeSettings {
  panelName: string;
  nodeNameTemplate: string;
  balanceStrategy: 'priority' | 'weight' | 'latency' | 'health';
  subscriptionUpdateHours: number;
  enableIpv6: boolean;
  trafficLoggingEnabled: boolean;
}

const SETTINGS_CACHE_KEY = 'edge:settings';

export async function loadEdgeSettings(env: EdgeBindings): Promise<EdgeSettings> {
  const cached = (await env.AFRA_KV.get(SETTINGS_CACHE_KEY, 'json').catch(
    () => null,
  )) as EdgeSettings | null;
  if (cached) return cached;

  const rows = await env.AFRA_DB.prepare(
    'SELECT key, value FROM system_settings WHERE is_secret = 0',
  ).all<{ key: string; value: string }>();

  const map: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    try {
      map[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      map[row.key] = row.value;
    }
  }

  const settings: EdgeSettings = {
    panelName: typeof map.panelName === 'string' ? map.panelName : 'پنل افرا',
    nodeNameTemplate:
      typeof map.nodeNameTemplate === 'string' ? map.nodeNameTemplate : '{FLAG} {COUNTRY} {NAME}',
    balanceStrategy: (map.balanceStrategy as EdgeSettings['balanceStrategy']) ?? 'latency',
    subscriptionUpdateHours:
      typeof map.subscriptionUpdateHours === 'number' ? map.subscriptionUpdateHours : 12,
    enableIpv6: map.enableIpv6 === true,
    trafficLoggingEnabled: map.trafficLoggingEnabled !== false,
  };

  await env.AFRA_KV.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), {
    expirationTtl: 60,
  }).catch(() => undefined);
  return settings;
}

/** بررسی مجاز بودن UUID برای اتصال پروکسی (allowlist در KV با fallback به D1). */
export async function authorizeUuid(
  env: EdgeBindings,
  uuid: string,
): Promise<{ allowed: boolean; userId?: string; reason?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return { allowed: false, reason: 'invalid_uuid' };
  }

  const cacheKey = `edge:user:${uuid.toLowerCase()}`;
  const cached = (await env.AFRA_KV.get(cacheKey, 'json').catch(() => null)) as
    | { userId: string; allowed: boolean }
    | null;
  if (cached) {
    return cached.allowed
      ? { allowed: true, userId: cached.userId }
      : { allowed: false, reason: 'not_allowed' };
  }

  const row = await env.AFRA_DB.prepare(
    `SELECT id, enabled, quota_bytes, used_bytes, expires_at
       FROM users WHERE credential_uuid = ?`,
  )
    .bind(uuid.toLowerCase())
    .first<{
      id: string;
      enabled: number;
      quota_bytes: number | null;
      used_bytes: number;
      expires_at: string | null;
    }>();

  if (!row) {
    await env.AFRA_KV.put(cacheKey, JSON.stringify({ userId: '', allowed: false }), {
      expirationTtl: 60,
    }).catch(() => undefined);
    return { allowed: false, reason: 'unknown_uuid' };
  }

  const expired = row.expires_at ? Date.parse(row.expires_at) <= Date.now() : false;
  const exhausted = row.quota_bytes !== null && (row.used_bytes ?? 0) >= row.quota_bytes;
  const allowed = row.enabled === 1 && !expired && !exhausted;

  await env.AFRA_KV.put(cacheKey, JSON.stringify({ userId: row.id, allowed }), {
    expirationTtl: 60,
  }).catch(() => undefined);

  return allowed
    ? { allowed: true, userId: row.id }
    : { allowed: false, reason: expired ? 'expired' : exhausted ? 'quota' : 'disabled' };
}

/** ثبت ترافیک مصرف‌شده (متادیتای عملیاتی؛ محتوای ترافیک بازرسی نمی‌شود). */
export async function recordTraffic(
  env: EdgeBindings,
  userId: string,
  bytes: number,
  nodeId: string | null = null,
): Promise<void> {
  if (bytes <= 0) return;
  const bucket = new Date();
  bucket.setUTCMinutes(0, 0, 0);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  try {
    await env.AFRA_DB.batch([
      env.AFRA_DB.prepare(
        `UPDATE users
            SET used_bytes = used_bytes + ?,
                daily_used_bytes = daily_used_bytes + ?,
                last_activity_at = ?
          WHERE id = ?`,
      ).bind(bytes, bytes, now, userId),
      env.AFRA_DB.prepare(
        'INSERT INTO traffic_samples (id, user_id, node_id, bytes, bucket_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(
        `trf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        userId,
        nodeId,
        bytes,
        bucket.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ),
    ]);
    // بی‌اعتبارسازی کش مجوز تا محدودیت حجم سریع اعمال شود
    await env.AFRA_KV.delete(`edge:usercache:${userId}`).catch(() => undefined);
  } catch (error) {
    console.error(JSON.stringify({ level: 'ERROR', message: 'traffic record failed', error: String(error) }));
  }
}
