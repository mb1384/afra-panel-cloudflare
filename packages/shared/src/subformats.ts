import { utf8ToBase64 } from './codec.js';
import { toClashRules } from './routing.js';
import type {
  BalanceStrategy,
  DnsServerRecord,
  RoutingRule,
  SubscriptionFormat,
} from './types.js';

export interface SubscriptionEntry {
  displayName: string;
  uri: string;
  clashProxy: Record<string, unknown> | null;
}

export interface SubscriptionBuildContext {
  entries: SubscriptionEntry[];
  routingRules: RoutingRule[];
  dnsServers: DnsServerRecord[];
  profileTitle: string;
  proxyGroupName: string;
  strategy: BalanceStrategy;
  updateIntervalHours: number;
  enableIpv6: boolean;
}

export interface SubFormatAdapter {
  readonly key: SubscriptionFormat;
  readonly labelFa: string;
  readonly contentType: string;
  build(ctx: SubscriptionBuildContext): string;
  headers(ctx: SubscriptionBuildContext): Record<string, string>;
}

/* ------------------------------- YAML emitter ------------------------------- */

const PLAIN_SAFE = /^[A-Za-z0-9_./:@+-]+$/;
const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~|)$/i;

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const text = String(value);
  if (PLAIN_SAFE.test(text) && !YAML_RESERVED.test(text) && !/^[0-9]+$/.test(text)) return text;
  if (/^[0-9]+$/.test(text)) return `'${text}'`;
  return `'${text.replace(/'/g, "''")}'`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toYaml(value: unknown, indentLevel = 0): string {
  const pad = '  '.repeat(indentLevel);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          const block = toYaml(item, indentLevel + 1);
          const trimmed = block.replace(/^\s+/, '');
          const rest = block.split('\n').slice(1).join('\n');
          return rest ? `${pad}- ${trimmed}\n${rest}` : `${pad}- ${trimmed}`;
        }
        return `${pad}- ${yamlScalar(item)}`;
      })
      .join('\n');
  }

  if (isPlainObject(value)) {
    const lines: string[] = [];
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${key}: []`);
        } else {
          lines.push(`${pad}${key}:`);
          lines.push(toYaml(val, indentLevel + 1));
        }
      } else if (isPlainObject(val)) {
        if (Object.keys(val).length === 0) {
          lines.push(`${pad}${key}: {}`);
        } else {
          lines.push(`${pad}${key}:`);
          lines.push(toYaml(val, indentLevel + 1));
        }
      } else {
        lines.push(`${pad}${key}: ${yamlScalar(val)}`);
      }
    }
    return lines.join('\n');
  }

  return `${pad}${yamlScalar(value)}`;
}

/* ------------------------------- DNS helpers ------------------------------- */

export function dnsServerToUri(server: Pick<DnsServerRecord, 'kind' | 'address'>): string {
  const address = server.address.trim();
  switch (server.kind) {
    case 'doh':
      return address.startsWith('http') ? address : `https://${address}`;
    case 'dot':
      return address.startsWith('tls://') ? address : `tls://${address}`;
    default:
      return address;
  }
}

const GROUP_TYPE: Record<BalanceStrategy, string> = {
  latency: 'url-test',
  weight: 'load-balance',
  health: 'fallback',
  priority: 'fallback',
};

/* ------------------------------- adapters ------------------------------- */

class AutoFormat implements SubFormatAdapter {
  readonly key: SubscriptionFormat = 'auto';
  readonly labelFa = 'خودکار';
  readonly contentType = 'text/plain; charset=utf-8';

  build(ctx: SubscriptionBuildContext): string {
    return ctx.entries.map((entry) => entry.uri).join('\n');
  }

  headers(ctx: SubscriptionBuildContext): Record<string, string> {
    return baseHeaders(ctx);
  }
}

class Base64Format implements SubFormatAdapter {
  readonly key: SubscriptionFormat = 'base64';
  readonly labelFa = 'Base64';
  readonly contentType = 'text/plain; charset=utf-8';

  build(ctx: SubscriptionBuildContext): string {
    return utf8ToBase64(ctx.entries.map((entry) => entry.uri).join('\n'));
  }

  headers(ctx: SubscriptionBuildContext): Record<string, string> {
    return baseHeaders(ctx);
  }
}

class ClashFormat implements SubFormatAdapter {
  readonly key: SubscriptionFormat = 'clash';
  readonly labelFa = 'Clash / Mihomo';
  readonly contentType = 'text/yaml; charset=utf-8';

  build(ctx: SubscriptionBuildContext): string {
    const proxies = ctx.entries
      .map((entry) => entry.clashProxy)
      .filter((proxy): proxy is Record<string, unknown> => proxy !== null);
    const names = proxies.map((proxy) => String(proxy.name));

    const nameservers = ctx.dnsServers
      .filter((server) => server.enabled && !server.isFallback)
      .map(dnsServerToUri);
    const fallbacks = ctx.dnsServers
      .filter((server) => server.enabled && server.isFallback)
      .map(dnsServerToUri);

    const groupName = ctx.proxyGroupName;
    const groups: Record<string, unknown>[] = [
      {
        name: groupName,
        type: GROUP_TYPE[ctx.strategy] ?? 'fallback',
        proxies: names.length > 0 ? names : ['DIRECT'],
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 100,
      },
    ];

    const document: Record<string, unknown> = {
      'mixed-port': 7890,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'info',
      ipv6: ctx.enableIpv6,
      'external-controller': '127.0.0.1:9090',
      dns: {
        enable: true,
        ipv6: ctx.enableIpv6,
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        nameserver: nameservers.length > 0 ? nameservers : ['https://1.1.1.1/dns-query'],
        fallback: fallbacks,
      },
      proxies,
      'proxy-groups': groups,
      rules: [...toClashRules(ctx.routingRules, groupName), `MATCH,${groupName}`],
    };

    const skipped = ctx.entries.length - proxies.length;
    const header = [
      `# ${ctx.profileTitle}`,
      '# تولید شده توسط پنل افرا — این فایل یک اعتبارنامه است و نباید عمومی شود.',
      skipped > 0 ? `# ${skipped} سرور به دلیل ناسازگاری transport با Clash حذف شد.` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return `${header}\n${toYaml(document)}\n`;
  }

  headers(ctx: SubscriptionBuildContext): Record<string, string> {
    return baseHeaders(ctx);
  }
}

function baseHeaders(ctx: SubscriptionBuildContext): Record<string, string> {
  return {
    'profile-title': `base64:${utf8ToBase64(ctx.profileTitle)}`,
    'profile-update-interval': String(ctx.updateIntervalHours),
    'subscription-userinfo': '',
  };
}

const FORMAT_REGISTRY = new Map<SubscriptionFormat, SubFormatAdapter>([
  ['auto', new AutoFormat()],
  ['base64', new Base64Format()],
  ['clash', new ClashFormat()],
]);

export function getSubFormatAdapter(key: SubscriptionFormat): SubFormatAdapter {
  const adapter = FORMAT_REGISTRY.get(key);
  if (!adapter) throw new Error(`subscription format not supported: ${key}`);
  return adapter;
}

export function listSubFormats(): SubFormatAdapter[] {
  return [...FORMAT_REGISTRY.values()];
}

/** تشخیص فرمت از روی User-Agent کلاینت برای حالت «خودکار». */
export function detectFormatFromUserAgent(userAgent: string | null): SubscriptionFormat {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'base64';
  if (/(clash|mihomo|stash|clashx|flclash)/.test(ua)) return 'clash';
  if (/(v2ray|v2box|nekobox|nekoray|sing-box|hiddify|streisand|shadowrocket|v2rayng)/.test(ua)) {
    return 'base64';
  }
  return 'base64';
}

/** هدر استاندارد مصرف ترافیک برای کلاینت‌های اشتراک. */
export function buildUserInfoHeader(input: {
  usedBytes: number;
  quotaBytes: number | null;
  expiresAt: string | null;
}): string {
  const total = input.quotaBytes ?? 0;
  const expire = input.expiresAt ? Math.floor(Date.parse(input.expiresAt) / 1000) : 0;
  return `upload=0; download=${Math.max(0, Math.floor(input.usedBytes))}; total=${total}; expire=${Number.isNaN(expire) ? 0 : expire}`;
}
