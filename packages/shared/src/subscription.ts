import { rankCandidates, toCandidate } from './balancer.js';
import { getProtocolAdapter } from './protocols.js';
import type { ClientCredentials } from './protocols.js';
import {
  buildUserInfoHeader,
  detectFormatFromUserAgent,
  getSubFormatAdapter,
} from './subformats.js';
import type { SubscriptionEntry } from './subformats.js';
import { renderNodeName } from './template.js';
import type {
  BalanceStrategy,
  DnsServerRecord,
  ProxyNode,
  RoutingRule,
  SubscriptionFormat,
} from './types.js';
import { isExpired, isQuotaExhausted } from './units.js';

export interface SubscriptionUserView {
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
}

export interface SubscriptionOptions {
  format: SubscriptionFormat;
  userAgent: string | null;
  panelName: string;
  nodeNameTemplate: string;
  strategy: BalanceStrategy;
  updateIntervalHours: number;
  enableIpv6: boolean;
}

export interface SubscriptionResult {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  effectiveFormat: SubscriptionFormat;
  nodeCount: number;
}

export type SubscriptionDenyReason = 'disabled' | 'expired' | 'exhausted' | null;

export function subscriptionDenyReason(
  user: SubscriptionUserView,
  now: Date = new Date(),
): SubscriptionDenyReason {
  if (!user.enabled) return 'disabled';
  if (isExpired(user.expiresAt, now)) return 'expired';
  if (isQuotaExhausted(user.quotaBytes, user.usedBytes)) return 'exhausted';
  return null;
}

/**
 * ساخت محتوای اشتراک به‌صورت خالص (بدون وابستگی به دیتابیس).
 * ترتیب Nodeها با موتور توازن بار تعیین می‌شود تا failover در سمت کلاینت
 * به‌صورت طبیعی رخ دهد (اولین endpoint سالم‌ترین است).
 */
export function buildSubscription(
  user: SubscriptionUserView,
  nodes: ProxyNode[],
  routingRules: RoutingRule[],
  dnsServers: DnsServerRecord[],
  options: SubscriptionOptions,
): SubscriptionResult {
  const effectiveFormat =
    options.format === 'auto' ? detectFormatFromUserAgent(options.userAgent) : options.format;

  const credentials: ClientCredentials = {
    uuid: user.credentialUuid,
    trojanPassword: user.trojanPassword,
    ssPassword: user.ssPassword,
  };

  const usable = nodes.filter((node) => node.enabled);
  const ranked = rankCandidates(usable.map(toCandidate), options.strategy);
  const byId = new Map(usable.map((node) => [node.id, node]));
  const orderedNodes = ranked
    .map((candidate) => byId.get(candidate.id))
    .filter((node): node is ProxyNode => node !== undefined);

  const entries: SubscriptionEntry[] = orderedNodes.map((node, index) => {
    const adapter = getProtocolAdapter(node.protocol);
    const displayName = renderNodeName(options.nodeNameTemplate, {
      name: node.name,
      country: node.country,
      city: node.city,
      flag: node.flag,
      protocol: node.protocol,
      index: index + 1,
    });
    return {
      displayName,
      uri: adapter.generateSubscriptionEntry(node, credentials, displayName),
      clashProxy: adapter.generateClashProxy(node, credentials, displayName),
    };
  });

  const formatAdapter = getSubFormatAdapter(effectiveFormat);
  const ctx = {
    entries,
    routingRules,
    dnsServers,
    profileTitle: options.panelName,
    proxyGroupName: options.panelName,
    strategy: options.strategy,
    updateIntervalHours: options.updateIntervalHours,
    enableIpv6: options.enableIpv6,
  };

  const headers = {
    ...formatAdapter.headers(ctx),
    'subscription-userinfo': buildUserInfoHeader({
      usedBytes: user.usedBytes,
      quotaBytes: user.quotaBytes,
      expiresAt: user.expiresAt,
    }),
  };

  return {
    body: formatAdapter.build(ctx),
    contentType: formatAdapter.contentType,
    headers,
    effectiveFormat,
    nodeCount: entries.length,
  };
}

/** تبدیل ردیف خام دیتابیس (JSON در ستون‌ها) به ProxyNode. */
export function parseNodeRow(row: {
  id: string;
  name: string;
  kind: string;
  country: string | null;
  city: string | null;
  flag: string | null;
  hostname: string;
  ip: string | null;
  port: number;
  protocol: string;
  transport_json: string;
  tls_json: string;
  cf_worker_name: string | null;
  cf_route_host: string | null;
  priority: number;
  weight: number;
  enabled: number;
  health: string;
  latency_ms: number | null;
  last_check_at: string | null;
  success_count?: number;
  failure_count?: number;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}): ProxyNode {
  const transport = safeJson(row.transport_json, { kind: 'ws' as const });
  const tls = safeJson(row.tls_json, { mode: 'tls' as const });
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'external' ? 'external' : 'cloudflare-edge',
    country: row.country,
    city: row.city,
    flag: row.flag,
    hostname: row.hostname,
    ip: row.ip,
    port: row.port,
    protocol: (row.protocol as ProxyNode['protocol']) ?? 'vless',
    transport: transport as ProxyNode['transport'],
    tls: tls as ProxyNode['tls'],
    cfWorkerName: row.cf_worker_name,
    cfRouteHost: row.cf_route_host,
    priority: row.priority,
    weight: row.weight,
    enabled: row.enabled === 1,
    health: (row.health as ProxyNode['health']) ?? 'unknown',
    latencyMs: row.latency_ms,
    lastCheckAt: row.last_check_at,
    successCount: row.success_count ?? 0,
    failureCount: row.failure_count ?? 0,
    notes: row.notes ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
