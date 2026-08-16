import type { RoutingAction, RoutingRule, RoutingRuleType } from './types.js';

/** انواعی که سمت سرور قابل ارزیابی هستند. geoip/geosite به کلاینت واگذار می‌شود. */
export const SERVER_EVALUABLE_TYPES: RoutingRuleType[] = [
  'domain',
  'domain-suffix',
  'domain-keyword',
  'ip',
  'cidr',
];

export function sortRules(rules: RoutingRule[]): RoutingRule[] {
  return [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^[0-9]{1,3}$/.test(p) && Number(p) <= 255);
}

export function isIpv6(value: string): boolean {
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':');
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0) >>> 0;
}

function expandIpv6(ip: string): bigint | null {
  const clean = ip.split('%')[0];
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{0,4}$/.test(group)) return null;
    result = (result << 16n) + BigInt(parseInt(group || '0', 16));
  }
  return result;
}

/** بررسی عضویت یک IP در CIDR (IPv4 و IPv6). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split('/');
  if (!range) return false;
  const prefix = prefixText === undefined ? null : Number(prefixText);

  if (isIpv4(range) && isIpv4(ip)) {
    const bits = prefix === null ? 32 : prefix;
    if (bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
  }

  if (isIpv6(range) && isIpv6(ip)) {
    const bits = prefix === null ? 128 : prefix;
    if (bits < 0 || bits > 128) return false;
    const a = expandIpv6(ip);
    const b = expandIpv6(range);
    if (a === null || b === null) return false;
    if (bits === 0) return true;
    const shift = BigInt(128 - bits);
    return a >> shift === b >> shift;
  }

  return false;
}

export function ruleMatches(rule: RoutingRule, target: string): boolean {
  const value = target.trim();
  if (!value) return false;
  switch (rule.type) {
    case 'domain':
      return normalizeDomain(value) === normalizeDomain(rule.pattern);
    case 'domain-suffix': {
      const domain = normalizeDomain(value);
      const suffix = normalizeDomain(rule.pattern).replace(/^\./, '');
      return domain === suffix || domain.endsWith(`.${suffix}`);
    }
    case 'domain-keyword':
      return normalizeDomain(value).includes(normalizeDomain(rule.pattern));
    case 'ip':
      return value === rule.pattern.trim();
    case 'cidr':
      return ipInCidr(value, rule.pattern.trim());
    case 'geoip':
    case 'geosite':
      // ارزیابی این قواعد در کلاینت انجام می‌شود (در کانفیگ تولیدی اعمال می‌گردد).
      return false;
    default:
      return false;
  }
}

/** اولین قاعدهٔ منطبق (بر اساس اولویت) را برمی‌گرداند. */
export function resolveAction(
  rules: RoutingRule[],
  target: string,
  fallback: RoutingAction = 'proxy',
): { action: RoutingAction; rule: RoutingRule | null } {
  for (const rule of sortRules(rules)) {
    if (ruleMatches(rule, target)) return { action: rule.action, rule };
  }
  return { action: fallback, rule: null };
}

const CLASH_TYPE: Record<RoutingRuleType, string> = {
  domain: 'DOMAIN',
  'domain-suffix': 'DOMAIN-SUFFIX',
  'domain-keyword': 'DOMAIN-KEYWORD',
  ip: 'IP-CIDR',
  cidr: 'IP-CIDR',
  geoip: 'GEOIP',
  geosite: 'GEOSITE',
};

/** تبدیل قواعد به فرمت Clash/Mihomo. */
export function toClashRules(rules: RoutingRule[], proxyGroupName: string): string[] {
  const targetOf = (action: RoutingAction): string =>
    action === 'direct' ? 'DIRECT' : action === 'block' ? 'REJECT' : proxyGroupName;
  return sortRules(rules).map((rule) => {
    const type = CLASH_TYPE[rule.type];
    let pattern = rule.pattern.trim();
    if (rule.type === 'ip' && !pattern.includes('/')) {
      pattern = isIpv6(pattern) ? `${pattern}/128` : `${pattern}/32`;
    }
    const suffix = rule.type === 'ip' || rule.type === 'cidr' ? ',no-resolve' : '';
    return `${type},${pattern},${targetOf(rule.action)}${suffix}`;
  });
}

/** اعتبارسنجی الگوی قاعده بر اساس نوع آن. */
export function validateRulePattern(type: RoutingRuleType, pattern: string): string | null {
  const value = pattern.trim();
  if (!value) return 'الگو نمی‌تواند خالی باشد.';
  switch (type) {
    case 'domain':
    case 'domain-suffix':
      return /^[a-zA-Z0-9.*_-]+$/.test(value) ? null : 'دامنه نامعتبر است.';
    case 'domain-keyword':
      return value.length >= 2 ? null : 'کلیدواژه باید حداقل ۲ نویسه باشد.';
    case 'ip':
      return isIpv4(value) || isIpv6(value) ? null : 'آدرس IP نامعتبر است.';
    case 'cidr': {
      if (!value.includes('/')) return 'CIDR باید شامل پیشوند باشد (مثال: 10.0.0.0/8).';
      const [range] = value.split('/');
      return isIpv4(range) || isIpv6(range) ? null : 'محدودهٔ CIDR نامعتبر است.';
    }
    case 'geoip':
      return /^[a-zA-Z-]{2,20}$/.test(value) ? null : 'کد GeoIP نامعتبر است.';
    case 'geosite':
      return /^[a-zA-Z0-9-]{2,40}$/.test(value) ? null : 'نام GeoSite نامعتبر است.';
    default:
      return 'نوع قاعده نامعتبر است.';
  }
}
