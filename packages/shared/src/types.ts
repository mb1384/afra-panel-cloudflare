/** انواع مشترک بین Control Plane، Edge Worker و رابط کاربری. */

export type Environment = 'development' | 'staging' | 'production';

export type ProtocolKey = 'vless' | 'trojan' | 'shadowsocks';
export type TransportKey = 'ws' | 'grpc' | 'xhttp';
export type TlsMode = 'none' | 'tls';
export type TlsVersion = '1.2' | '1.3';

/** نوع Node: endpoint مدیریت‌شده روی Cloudflare یا سرور خارجی. */
export type NodeKind = 'cloudflare-edge' | 'external';

export type HealthState = 'healthy' | 'degraded' | 'unreachable' | 'disabled' | 'unknown';

export type SubscriptionFormat = 'auto' | 'base64' | 'clash';

export type BalanceStrategy = 'priority' | 'weight' | 'latency' | 'health';

export type RoutingRuleType =
  | 'domain'
  | 'domain-suffix'
  | 'domain-keyword'
  | 'ip'
  | 'cidr'
  | 'geoip'
  | 'geosite';

export type RoutingAction = 'direct' | 'proxy' | 'block';

export type DnsKind = 'udp' | 'doh' | 'dot';

export type FilterListKind = 'whitelist' | 'blacklist' | 'ads' | 'trackers' | 'custom';

export type ChainHopKind = 'node' | 'socks5' | 'http' | 'https-connect';

export type RoleName = 'super_admin' | 'admin' | 'read_only';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type AlpnProtocol = 'h2' | 'http/1.1' | 'h3';

export type TlsFingerprint =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'ios'
  | 'android'
  | 'edge'
  | 'random'
  | 'randomized';

export interface TlsConfig {
  mode: TlsMode;
  sni?: string | null;
  alpn?: AlpnProtocol[] | null;
  fingerprint?: TlsFingerprint | null;
  minVersion?: TlsVersion | null;
  allowInsecure?: boolean;
}

export interface TransportConfig {
  kind: TransportKey;
  path?: string | null;
  host?: string | null;
  serviceName?: string | null;
  mode?: string | null;
}

export interface AdminRecord {
  id: string;
  username: string;
  email: string | null;
  roleId: string;
  roleName: RoleName | string;
  enabled: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PanelUser {
  id: string;
  name: string;
  username: string;
  description: string | null;
  credentialUuid: string;
  trojanPassword: string;
  ssPassword: string;
  enabled: boolean;
  quotaBytes: number | null;
  dailyQuotaBytes: number | null;
  usedBytes: number;
  dailyUsedBytes: number;
  expiresAt: string | null;
  lastActivityAt: string | null;
  tags: string[];
  nodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  token: string;
  format: SubscriptionFormat;
  revokedAt: string | null;
  rotatedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  createdAt: string;
}

export interface ProxyNode {
  id: string;
  name: string;
  kind: NodeKind;
  country: string | null;
  city: string | null;
  flag: string | null;
  hostname: string;
  ip: string | null;
  port: number;
  protocol: ProtocolKey;
  transport: TransportConfig;
  tls: TlsConfig;
  /** میزبان مقصد برای endpointهای Cloudflare (اختیاری) */
  cfWorkerName: string | null;
  cfRouteHost: string | null;
  priority: number;
  weight: number;
  enabled: boolean;
  health: HealthState;
  latencyMs: number | null;
  lastCheckAt: string | null;
  successCount: number;
  failureCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  type: RoutingRuleType;
  pattern: string;
  action: RoutingAction;
  priority: number;
  enabled: boolean;
}

export interface DnsServerRecord {
  id: string;
  name: string;
  kind: DnsKind;
  address: string;
  isPrimary: boolean;
  isFallback: boolean;
  enabled: boolean;
  supportsIpv6: boolean;
  health: HealthState;
  latencyMs: number | null;
  lastCheckAt: string | null;
}

export interface ChainHop {
  kind: ChainHopKind;
  nodeId?: string;
  host?: string;
  port?: number;
  username?: string | null;
  password?: string | null;
}

export interface ProxyChainRecord {
  id: string;
  name: string;
  hops: ChainHop[];
  enabled: boolean;
  notes: string | null;
  createdAt: string;
}

export interface BackendRecord {
  id: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'basic';
  enabled: boolean;
  health: HealthState;
  latencyMs: number | null;
  lastCheckAt: string | null;
  isFallback: boolean;
}

export interface WarpConfigRecord {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  routeMode: 'off' | 'selected' | 'all';
  health: HealthState;
  latencyMs: number | null;
  lastCheckAt: string | null;
}

export interface AuditEntry {
  id: string;
  adminId: string | null;
  adminUsername: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  result: 'success' | 'failure';
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardStats {
  users: { total: number; active: number; expired: number; disabled: number };
  traffic: { usedBytes: number; quotaBytes: number; remainingBytes: number | null };
  nodes: { total: number; healthy: number; degraded: number; unreachable: number; avgLatencyMs: number | null };
  backend: { total: number; healthy: number };
  dns: { total: number; healthy: number };
  telegram: { configured: boolean; healthy: boolean };
  cloudflare: { configured: boolean; healthy: boolean; accountId: string | null };
  system: { environment: Environment; version: string; time: string };
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
