import {
  buildSubscription,
  detectFormatFromUserAgent,
  formatBytes,
  getProtocolAdapter,
  ipInCidr,
  parseSize,
  pickCandidate,
  rankCandidates,
  renderNodeName,
  resolveAction,
  toClashRules,
  usagePercent,
  userState,
  validateRulePattern,
} from '@afra/shared';
import type { ProxyNode, RoutingRule } from '@afra/shared';
import { describe, expect, it } from 'vitest';

function makeNode(overrides: Partial<ProxyNode> = {}): ProxyNode {
  return {
    id: 'nod_1',
    name: 'آلمان یک',
    kind: 'cloudflare-edge',
    country: 'DE',
    city: 'Frankfurt',
    flag: '🇩🇪',
    hostname: 'edge.example.com',
    ip: null,
    port: 443,
    protocol: 'vless',
    transport: { kind: 'ws', path: '/afra', host: null, serviceName: null, mode: null },
    tls: { mode: 'tls', sni: 'edge.example.com', alpn: ['h2'], fingerprint: 'chrome', minVersion: '1.3', allowInsecure: false },
    cfWorkerName: 'afra-edge-1',
    cfRouteHost: null,
    priority: 1,
    weight: 70,
    enabled: true,
    health: 'healthy',
    latencyMs: 120,
    lastCheckAt: null,
    successCount: 5,
    failureCount: 0,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('واحدهای حجم و سهمیه', () => {
  it('حجم را به فارسی قالب‌بندی می‌کند', () => {
    expect(formatBytes(null)).toBe('نامحدود');
    expect(formatBytes(0)).toBe('0 بایت');
    expect(formatBytes(1024)).toBe('1 کیلوبایت');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 گیگابایت');
  });

  it('رشتهٔ حجم را به بایت تبدیل می‌کند', () => {
    expect(parseSize('10GB')).toBe(10 * 1024 ** 3);
    expect(parseSize('512 MB')).toBe(512 * 1024 ** 2);
    expect(parseSize('نامحدود')).toBeNull();
    expect(parseSize('0')).toBeNull();
    expect(parseSize('abc')).toBeNull();
  });

  it('درصد مصرف و وضعیت کاربر را درست محاسبه می‌کند', () => {
    expect(usagePercent(100, 25)).toBe(25);
    expect(usagePercent(null, 25)).toBe(0);
    expect(userState({ enabled: true, expiresAt: null, quotaBytes: 100, usedBytes: 100 })).toBe('exhausted');
    expect(userState({ enabled: false, expiresAt: null, quotaBytes: null, usedBytes: 0 })).toBe('disabled');
    expect(
      userState({ enabled: true, expiresAt: '2020-01-01T00:00:00Z', quotaBytes: null, usedBytes: 0 }),
    ).toBe('expired');
    expect(userState({ enabled: true, expiresAt: null, quotaBytes: null, usedBytes: 5 })).toBe('active');
  });
});

describe('قالب نام Node', () => {
  it('متغیرها را جای‌گذاری می‌کند', () => {
    expect(
      renderNodeName('{FLAG} {COUNTRY} {CITY} {NAME}', {
        name: 'یک',
        country: 'DE',
        city: 'Frankfurt',
        flag: '🇩🇪',
      }),
    ).toBe('🇩🇪 DE Frankfurt یک');
  });

  it('متغیر ناشناخته را دست‌نخورده نگه می‌دارد و پرچم را از کد کشور می‌سازد', () => {
    const rendered = renderNodeName('{FLAG} {NAME} {UNKNOWN}', { name: 'تست', country: 'NL' });
    expect(rendered).toContain('🇳🇱');
    expect(rendered).toContain('{UNKNOWN}');
  });
});

describe('موتور توازن بار', () => {
  const candidates = [
    { id: 'a', priority: 1, weight: 70, health: 'healthy' as const, latencyMs: 200, enabled: true },
    { id: 'b', priority: 1, weight: 30, health: 'healthy' as const, latencyMs: 100, enabled: true },
    { id: 'c', priority: 2, weight: 90, health: 'unreachable' as const, latencyMs: null, enabled: true },
    { id: 'd', priority: 1, weight: 50, health: 'healthy' as const, latencyMs: 50, enabled: false },
  ];

  it('Nodeهای غیرفعال و خارج از دسترس را حذف می‌کند', () => {
    const ranked = rankCandidates(candidates, 'priority');
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('استراتژی latency کم‌ترین تأخیر را اول می‌گذارد', () => {
    expect(rankCandidates(candidates, 'latency')[0]?.id).toBe('b');
  });

  it('انتخاب وزنی قطعی است', () => {
    expect(pickCandidate(candidates, 'weight', 0.1)?.id).toBe('a');
    expect(pickCandidate(candidates, 'weight', 0.9)?.id).toBe('b');
  });

  it('در صورت نبود کاندیدای سالم null برمی‌گرداند', () => {
    expect(pickCandidate([candidates[2], candidates[3]], 'priority')).toBeNull();
  });
});

describe('موتور مسیریابی', () => {
  const rules: RoutingRule[] = [
    { id: '1', name: 'محلی', type: 'cidr', pattern: '10.0.0.0/8', action: 'direct', priority: 1, enabled: true },
    { id: '2', name: 'ir', type: 'domain-suffix', pattern: 'ir', action: 'direct', priority: 2, enabled: true },
    { id: '3', name: 'ads', type: 'domain-keyword', pattern: 'doubleclick', action: 'block', priority: 3, enabled: true },
    { id: '4', name: 'غیرفعال', type: 'domain', pattern: 'example.com', action: 'block', priority: 0, enabled: false },
  ];

  it('CIDR نسخهٔ ۴ و ۶ را تشخیص می‌دهد', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.1.2.3', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:dba::1', '2001:db8::/32')).toBe(false);
  });

  it('اولین قاعدهٔ منطبق را بر اساس اولویت برمی‌گرداند', () => {
    expect(resolveAction(rules, '10.5.5.5').action).toBe('direct');
    expect(resolveAction(rules, 'site.ir').action).toBe('direct');
    expect(resolveAction(rules, 'ads.doubleclick.net').action).toBe('block');
    expect(resolveAction(rules, 'example.com').action).toBe('proxy');
  });

  it('قواعد را به فرمت Clash تبدیل می‌کند', () => {
    const clash = toClashRules(rules, 'افرا');
    expect(clash).toContain('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve');
    expect(clash).toContain('DOMAIN-KEYWORD,doubleclick,REJECT');
    expect(clash).not.toContain('example.com');
  });

  it('الگوی نامعتبر را رد می‌کند', () => {
    expect(validateRulePattern('cidr', '10.0.0.0')).not.toBeNull();
    expect(validateRulePattern('cidr', '10.0.0.0/8')).toBeNull();
    expect(validateRulePattern('ip', 'not-an-ip')).not.toBeNull();
  });
});

describe('adapterهای پروتکل', () => {
  it('URI معتبر VLESS تولید می‌کند', () => {
    const node = makeNode();
    const uri = getProtocolAdapter('vless').generateSubscriptionEntry(
      node,
      { uuid: '11111111-2222-3333-4444-555555555555', trojanPassword: 'p', ssPassword: 's' },
      'آلمان',
    );
    expect(uri.startsWith('vless://11111111-2222-3333-4444-555555555555@edge.example.com:443?')).toBe(true);
    expect(uri).toContain('type=ws');
    expect(uri).toContain('security=tls');
    expect(uri).toContain('path=%2Fafra');
  });

  it('Trojan روی endpoint لبهٔ Cloudflare رد می‌شود', () => {
    const result = getProtocolAdapter('trojan').validate(
      makeNode({ protocol: 'trojan', kind: 'cloudflare-edge' }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'kind')).toBe(true);
  });

  it('Trojan روی Node بیرونی با TLS معتبر است', () => {
    const result = getProtocolAdapter('trojan').validate(
      makeNode({ protocol: 'trojan', kind: 'external' }),
    );
    expect(result.valid).toBe(true);
  });

  it('xhttp در خروجی Clash حذف می‌شود', () => {
    const node = makeNode({
      transport: { kind: 'xhttp', path: '/x', host: null, serviceName: null, mode: 'auto' },
    });
    const proxy = getProtocolAdapter('vless').generateClashProxy(
      node,
      { uuid: '11111111-2222-3333-4444-555555555555', trojanPassword: 'p', ssPassword: 's' },
      'x',
    );
    expect(proxy).toBeNull();
  });
});

describe('تولید اشتراک', () => {
  const user = {
    id: 'usr_1',
    name: 'کاربر تست',
    username: 'test',
    credentialUuid: '11111111-2222-3333-4444-555555555555',
    trojanPassword: 'trojanpass',
    ssPassword: 'sspass',
    enabled: true,
    quotaBytes: 10 * 1024 ** 3,
    usedBytes: 1024 ** 3,
    expiresAt: '2030-01-01T00:00:00Z',
  };

  const options = {
    format: 'base64' as const,
    userAgent: null,
    panelName: 'افرا',
    nodeNameTemplate: '{FLAG} {NAME}',
    strategy: 'latency' as const,
    updateIntervalHours: 12,
    enableIpv6: false,
  };

  it('فرمت را از User-Agent تشخیص می‌دهد', () => {
    expect(detectFormatFromUserAgent('ClashX/1.0')).toBe('clash');
    expect(detectFormatFromUserAgent('v2rayNG/1.8')).toBe('base64');
    expect(detectFormatFromUserAgent(null)).toBe('base64');
  });

  it('خروجی base64 قابل رمزگشایی است و هدر مصرف را دارد', () => {
    const result = buildSubscription(user, [makeNode()], [], [], options);
    expect(result.effectiveFormat).toBe('base64');
    expect(atob(result.body)).toContain('vless://');
    expect(result.headers['subscription-userinfo']).toContain('total=10737418240');
    expect(result.nodeCount).toBe(1);
  });

  it('خروجی Clash یک YAML معتبر با گروه پروکسی می‌سازد', () => {
    const result = buildSubscription(user, [makeNode()], [], [], { ...options, format: 'clash' });
    expect(result.contentType).toContain('yaml');
    expect(result.body).toContain('proxies:');
    expect(result.body).toContain("type: vless");
    expect(result.body).toContain('proxy-groups:');
    expect(result.body).toContain('MATCH,افرا');
  });

  it('Nodeهای غیرفعال در اشتراک ظاهر نمی‌شوند', () => {
    const result = buildSubscription(
      user,
      [makeNode({ enabled: false })],
      [],
      [],
      options,
    );
    expect(result.nodeCount).toBe(0);
  });
});
