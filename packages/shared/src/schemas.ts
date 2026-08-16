import { z } from 'zod';

/* ----------------------------- helpers ----------------------------- */

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : (v ?? null)));

const hostname = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/, {
    message: 'میزبان نامعتبر است.',
  });

const port = z.coerce.number().int().min(1).max(65535);
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/* ----------------------------- auth ----------------------------- */

export const loginSchema = z.object({
  username: trimmed(3, 64),
  password: z.string().min(8).max(200),
  totp: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, { message: 'کد باید ۶ رقم باشد.' })
    .optional(),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(8).max(200),
    newPassword: z
      .string()
      .min(12, { message: 'گذرواژه باید حداقل ۱۲ نویسه باشد.' })
      .max(200)
      .regex(/[a-z]/, { message: 'گذرواژه باید حرف کوچک داشته باشد.' })
      .regex(/[A-Z]/, { message: 'گذرواژه باید حرف بزرگ داشته باشد.' })
      .regex(/[0-9]/, { message: 'گذرواژه باید رقم داشته باشد.' }),
  })
  .strict();

export const totpVerifySchema = z.object({
  code: z.string().trim().regex(/^[0-9]{6}$/),
});

export const setupSchema = z.object({
  username: trimmed(3, 64).regex(/^[a-zA-Z0-9._-]+$/, {
    message: 'نام کاربری فقط شامل حروف لاتین، رقم، نقطه، خط تیره و زیرخط باشد.',
  }),
  email: z.string().trim().email().optional().or(z.literal('')),
  password: z
    .string()
    .min(12, { message: 'گذرواژه باید حداقل ۱۲ نویسه باشد.' })
    .max(200)
    .regex(/[a-z]/, { message: 'گذرواژه باید حرف کوچک داشته باشد.' })
    .regex(/[A-Z]/, { message: 'گذرواژه باید حرف بزرگ داشته باشد.' })
    .regex(/[0-9]/, { message: 'گذرواژه باید رقم داشته باشد.' }),
  panelName: trimmed(2, 60).default('پنل افرا'),
  timezone: trimmed(3, 60).default('Asia/Tehran'),
  edgeUrl: z.string().trim().url().optional().or(z.literal('')),
});

export const adminCreateSchema = z.object({
  username: trimmed(3, 64),
  email: z.string().trim().email().optional().or(z.literal('')),
  password: z.string().min(12).max(200),
  role: z.enum(['super_admin', 'admin', 'read_only']),
});

/* ----------------------------- users ----------------------------- */

export const userCreateSchema = z.object({
  name: trimmed(2, 80),
  username: trimmed(3, 64).regex(/^[a-zA-Z0-9._-]+$/, {
    message: 'نام کاربری فقط شامل حروف لاتین، رقم، نقطه، خط تیره و زیرخط باشد.',
  }),
  description: optionalText(500),
  quota: z.string().trim().max(20).optional().nullable(),
  dailyQuota: z.string().trim().max(20).optional().nullable(),
  expiresAt: isoDate.optional().nullable(),
  expiresInDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  enabled: z.boolean().default(true),
  tags: z.array(trimmed(1, 24)).max(20).default([]),
  nodeIds: z.array(z.string().trim().min(1)).max(200).default([]),
  subscriptionFormat: z.enum(['auto', 'base64', 'clash']).default('auto'),
});

export const userUpdateSchema = userCreateSchema.partial().extend({
  username: userCreateSchema.shape.username.optional(),
});

export const userQuerySchema = paginationSchema.extend({
  state: z.enum(['all', 'active', 'disabled', 'expired', 'exhausted']).default('all'),
  tag: z.string().trim().max(24).optional(),
  nodeId: z.string().trim().max(40).optional(),
});

export const userBulkSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
  action: z.enum(['enable', 'disable', 'delete', 'reset-traffic', 'extend', 'rotate-token']),
  extendDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export const userExtendSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650),
});

export const trafficReportSchema = z.object({
  samples: z
    .array(
      z.object({
        userId: z.string().trim().min(1),
        nodeId: z.string().trim().min(1).optional().nullable(),
        bytes: z.coerce.number().int().min(0).max(1_099_511_627_776),
      }),
    )
    .min(1)
    .max(2000),
});

/* ----------------------------- nodes ----------------------------- */

export const tlsSchema = z.object({
  mode: z.enum(['none', 'tls']).default('tls'),
  sni: optionalText(253),
  alpn: z.array(z.enum(['h2', 'http/1.1', 'h3'])).max(3).optional().nullable(),
  fingerprint: z
    .enum(['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'])
    .optional()
    .nullable(),
  minVersion: z.enum(['1.2', '1.3']).optional().nullable(),
  allowInsecure: z.boolean().default(false),
});

export const transportSchema = z.object({
  kind: z.enum(['ws', 'grpc', 'xhttp']).default('ws'),
  path: optionalText(200),
  host: optionalText(253),
  serviceName: optionalText(120),
  mode: optionalText(30),
});

export const nodeCreateSchema = z.object({
  name: trimmed(2, 60),
  kind: z.enum(['cloudflare-edge', 'external']).default('cloudflare-edge'),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, { message: 'کد کشور باید دو حرفی باشد (مثال: DE).' })
    .optional()
    .nullable()
    .or(z.literal('')),
  city: optionalText(60),
  flag: optionalText(8),
  hostname,
  ip: optionalText(45),
  port: port.default(443),
  protocol: z.enum(['vless', 'trojan', 'shadowsocks']).default('vless'),
  transport: transportSchema.default({ kind: 'ws', path: '/afra', host: null, serviceName: null, mode: null }),
  tls: tlsSchema.default({ mode: 'tls', sni: null, alpn: null, fingerprint: 'chrome', minVersion: '1.3', allowInsecure: false }),
  cfWorkerName: optionalText(64),
  cfRouteHost: optionalText(253),
  priority: z.coerce.number().int().min(1).max(100).default(1),
  weight: z.coerce.number().int().min(0).max(1000).default(50),
  enabled: z.boolean().default(true),
  notes: optionalText(500),
});

export const nodeUpdateSchema = nodeCreateSchema.partial();

export const nodeQuerySchema = paginationSchema.extend({
  health: z.enum(['all', 'healthy', 'degraded', 'unreachable', 'disabled', 'unknown']).default('all'),
  kind: z.enum(['all', 'cloudflare-edge', 'external']).default('all'),
  protocol: z.enum(['all', 'vless', 'trojan', 'shadowsocks']).default('all'),
});

/* ----------------------------- routing / dns / filters ----------------------------- */

export const routingRuleSchema = z.object({
  name: trimmed(2, 60),
  type: z.enum(['domain', 'domain-suffix', 'domain-keyword', 'ip', 'cidr', 'geoip', 'geosite']),
  pattern: trimmed(1, 200),
  action: z.enum(['direct', 'proxy', 'block']),
  priority: z.coerce.number().int().min(1).max(9999).default(100),
  enabled: z.boolean().default(true),
});

export const routingImportSchema = z.object({
  rules: z.array(routingRuleSchema).min(1).max(2000),
  replace: z.boolean().default(false),
});

export const dnsServerSchema = z.object({
  name: trimmed(2, 60),
  kind: z.enum(['udp', 'doh', 'dot']),
  address: trimmed(3, 200),
  isPrimary: z.boolean().default(false),
  isFallback: z.boolean().default(false),
  enabled: z.boolean().default(true),
  supportsIpv6: z.boolean().default(false),
});

export const domainFilterSchema = z.object({
  name: trimmed(2, 60),
  kind: z.enum(['whitelist', 'blacklist', 'ads', 'trackers', 'custom']),
  entries: z.array(trimmed(1, 253)).max(20000).default([]),
  enabled: z.boolean().default(true),
});

/* ----------------------------- chains / backends / warp ----------------------------- */

export const chainHopSchema = z.object({
  kind: z.enum(['node', 'socks5', 'http', 'https-connect']),
  nodeId: z.string().trim().min(1).optional(),
  host: z.string().trim().min(1).max(253).optional(),
  port: port.optional(),
  username: optionalText(80),
  password: optionalText(200),
});

export const proxyChainSchema = z.object({
  name: trimmed(2, 60),
  hops: z.array(chainHopSchema).min(2).max(6),
  enabled: z.boolean().default(true),
  notes: optionalText(300),
});

export const backendSchema = z.object({
  name: trimmed(2, 60),
  url: z.string().trim().url().max(300),
  authType: z.enum(['none', 'bearer', 'basic']).default('bearer'),
  secret: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().default(true),
  isFallback: z.boolean().default(false),
});

export const warpSchema = z.object({
  name: trimmed(2, 60),
  endpoint: trimmed(3, 200),
  enabled: z.boolean().default(false),
  routeMode: z.enum(['off', 'selected', 'all']).default('off'),
});

/* ----------------------------- telegram ----------------------------- */

export const telegramSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().trim().max(200).optional().nullable(),
  webhookSecret: z.string().trim().max(200).optional().nullable(),
  notifyEvents: z.array(z.string().trim().max(40)).max(30).default([]),
});

export const telegramAdminSchema = z.object({
  telegramId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,20}$/, { message: 'شناسه تلگرام باید عددی باشد.' }),
  label: optionalText(60),
  role: z.enum(['admin', 'read_only']).default('read_only'),
});

/* ----------------------------- cloudflare ----------------------------- */

export const cloudflareSettingsSchema = z.object({
  accountId: z.string().trim().max(64).optional().nullable(),
  apiToken: z.string().trim().max(200).optional().nullable(),
  defaultZoneId: z.string().trim().max(64).optional().nullable(),
});

export const cfDnsRecordSchema = z.object({
  zoneId: trimmed(3, 64),
  type: z.enum(['A', 'AAAA', 'CNAME', 'TXT']),
  name: trimmed(1, 253),
  content: trimmed(1, 500),
  proxied: z.boolean().default(true),
  ttl: z.coerce.number().int().min(1).max(86400).default(1),
});

export const cfEndpointDeploySchema = z.object({
  nodeId: z.string().trim().min(1),
  scriptName: z
    .string()
    .trim()
    .min(3)
    .max(54)
    .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'نام Worker فقط حروف کوچک، رقم و خط تیره.' }),
  routeHost: z.string().trim().max(253).optional().nullable(),
  zoneId: z.string().trim().max(64).optional().nullable(),
});

/* ----------------------------- settings / backup ----------------------------- */

export const settingsUpdateSchema = z.object({
  panelName: trimmed(2, 60).optional(),
  language: z.enum(['fa', 'en', 'ru']).optional(),
  timezone: trimmed(3, 60).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  calendar: z.enum(['jalali', 'gregorian']).optional(),
  edgeUrl: z.string().trim().max(300).optional(),
  sessionTtlMinutes: z.coerce.number().int().min(15).max(20160).optional(),
  loginRateLimit: z.coerce.number().int().min(3).max(100).optional(),
  apiRateLimit: z.coerce.number().int().min(30).max(10000).optional(),
  healthCheckIntervalMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  healthCheckTimeoutMs: z.coerce.number().int().min(500).max(15000).optional(),
  degradedLatencyMs: z.coerce.number().int().min(50).max(10000).optional(),
  balanceStrategy: z.enum(['priority', 'weight', 'latency', 'health']).optional(),
  failoverEnabled: z.boolean().optional(),
  nodeNameTemplate: trimmed(2, 120).optional(),
  defaultSubscriptionFormat: z.enum(['auto', 'base64', 'clash']).optional(),
  subscriptionUpdateHours: z.coerce.number().int().min(1).max(168).optional(),
  revokeOnExpire: z.boolean().optional(),
  enableIpv6: z.boolean().optional(),
  quotaWarningPercent: z.coerce.number().int().min(50).max(99).optional(),
  expiryWarningDays: z.coerce.number().int().min(1).max(60).optional(),
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  logRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  trafficLoggingEnabled: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
});

export const backupCreateSchema = z.object({
  includeSecrets: z.boolean().default(false),
  encrypt: z.boolean().default(true),
  passphrase: z.string().min(12).max(200).optional(),
});

export const backupRestoreSchema = z.object({
  key: trimmed(3, 300),
  passphrase: z.string().min(12).max(200).optional(),
  wipeExisting: z.boolean().default(false),
});

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
  result: z.enum(['all', 'success', 'failure']).default('all'),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

export const analyticsQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('7d'),
});

/* ----------------------------- inferred types ----------------------------- */

export type LoginInput = z.infer<typeof loginSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
export type NodeCreateInput = z.infer<typeof nodeCreateSchema>;
export type NodeUpdateInput = z.infer<typeof nodeUpdateSchema>;
export type RoutingRuleInput = z.infer<typeof routingRuleSchema>;
export type DnsServerInput = z.infer<typeof dnsServerSchema>;
export type ProxyChainInput = z.infer<typeof proxyChainSchema>;
export type BackendInput = z.infer<typeof backendSchema>;
export type WarpInput = z.infer<typeof warpSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type TelegramSettingsInput = z.infer<typeof telegramSettingsSchema>;
export type CloudflareSettingsInput = z.infer<typeof cloudflareSettingsSchema>;
export type CfEndpointDeployInput = z.infer<typeof cfEndpointDeploySchema>;
export type BackupCreateInput = z.infer<typeof backupCreateSchema>;
export type DomainFilterInput = z.infer<typeof domainFilterSchema>;
