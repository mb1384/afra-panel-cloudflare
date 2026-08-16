import type {
  AuditEntry,
  BackendRecord,
  ChainHop,
  DnsServerRecord,
  NotificationRecord,
  PanelUser,
  ProxyChainRecord,
  RoutingRule,
  SubscriptionRecord,
  WarpConfigRecord,
} from '@afra/shared';

export function safeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export interface UserRow {
  id: string;
  name: string;
  username: string;
  description: string | null;
  credential_uuid: string;
  trojan_password: string;
  ss_password: string;
  enabled: number;
  quota_bytes: number | null;
  daily_quota_bytes: number | null;
  used_bytes: number;
  daily_used_bytes: number;
  expires_at: string | null;
  last_activity_at: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  node_ids?: string | null;
}

export function rowToUser(row: UserRow): PanelUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    description: row.description,
    credentialUuid: row.credential_uuid,
    trojanPassword: row.trojan_password,
    ssPassword: row.ss_password,
    enabled: row.enabled === 1,
    quotaBytes: row.quota_bytes,
    dailyQuotaBytes: row.daily_quota_bytes,
    usedBytes: row.used_bytes ?? 0,
    dailyUsedBytes: row.daily_used_bytes ?? 0,
    expiresAt: row.expires_at,
    lastActivityAt: row.last_activity_at,
    tags: safeJson<string[]>(row.tags, []),
    nodeIds: row.node_ids ? row.node_ids.split(',').filter(Boolean) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  token: string;
  format: string;
  revoked_at: string | null;
  rotated_at: string | null;
  last_access_at: string | null;
  access_count: number;
  created_at: string;
}

export function rowToSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    format: row.format as SubscriptionRecord['format'],
    revokedAt: row.revoked_at,
    rotatedAt: row.rotated_at,
    lastAccessAt: row.last_access_at,
    accessCount: row.access_count ?? 0,
    createdAt: row.created_at,
  };
}

export function rowToRoutingRule(row: {
  id: string;
  name: string;
  type: string;
  pattern: string;
  action: string;
  priority: number;
  enabled: number;
}): RoutingRule {
  return {
    id: row.id,
    name: row.name,
    type: row.type as RoutingRule['type'],
    pattern: row.pattern,
    action: row.action as RoutingRule['action'],
    priority: row.priority,
    enabled: row.enabled === 1,
  };
}

export function rowToDnsServer(row: {
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
}): DnsServerRecord {
  return {
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
  };
}

export function rowToChain(row: {
  id: string;
  name: string;
  hops_json: string;
  enabled: number;
  notes: string | null;
  created_at: string;
}): ProxyChainRecord {
  return {
    id: row.id,
    name: row.name,
    hops: safeJson<ChainHop[]>(row.hops_json, []),
    enabled: row.enabled === 1,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function rowToBackend(row: {
  id: string;
  name: string;
  url: string;
  auth_type: string;
  enabled: number;
  is_fallback: number;
  health: string;
  latency_ms: number | null;
  last_check_at: string | null;
}): BackendRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authType: row.auth_type as BackendRecord['authType'],
    enabled: row.enabled === 1,
    isFallback: row.is_fallback === 1,
    health: row.health as BackendRecord['health'],
    latencyMs: row.latency_ms,
    lastCheckAt: row.last_check_at,
  };
}

export function rowToWarp(row: {
  id: string;
  name: string;
  endpoint: string;
  enabled: number;
  route_mode: string;
  health: string;
  latency_ms: number | null;
  last_check_at: string | null;
}): WarpConfigRecord {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    enabled: row.enabled === 1,
    routeMode: row.route_mode as WarpConfigRecord['routeMode'],
    health: row.health as WarpConfigRecord['health'],
    latencyMs: row.latency_ms,
    lastCheckAt: row.last_check_at,
  };
}

export function rowToAudit(row: {
  id: string;
  admin_id: string | null;
  admin_username: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  result: string;
  ip: string | null;
  metadata: string | null;
  created_at: string;
}): AuditEntry {
  return {
    id: row.id,
    adminId: row.admin_id,
    adminUsername: row.admin_username,
    action: row.action,
    resource: row.resource,
    resourceId: row.resource_id,
    result: row.result === 'failure' ? 'failure' : 'success',
    ip: row.ip,
    metadata: safeJson<Record<string, unknown> | null>(row.metadata, null),
    createdAt: row.created_at,
  };
}

export function rowToNotification(row: {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity as NotificationRecord['severity'],
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/** ساخت شرط جستجو برای LIKE با فرار از کاراکترهای ویژه. */
export function likePattern(search: string): string {
  return `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}
