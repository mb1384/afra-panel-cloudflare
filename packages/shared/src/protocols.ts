import { utf8ToBase64 } from './codec.js';
import type { ProtocolKey, ProxyNode, TransportKey } from './types.js';

export interface ClientCredentials {
  uuid: string;
  trojanPassword: string;
  ssPassword: string;
  ssMethod?: string;
}

export interface ProtocolMetadata {
  key: ProtocolKey;
  labelFa: string;
  supportedTransports: TransportKey[];
  requiresTls: boolean;
  /** آیا این پروتکل روی Worker لبهٔ افرا قابل اجراست؟ */
  edgeRuntimeSupported: boolean;
  credentialLabelFa: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ProtocolAdapter {
  readonly key: ProtocolKey;
  getMetadata(): ProtocolMetadata;
  validate(node: ProxyNode): ValidationResult;
  /** یک URI اشتراک برای این Node تولید می‌کند. */
  generateSubscriptionEntry(node: ProxyNode, creds: ClientCredentials, displayName: string): string;
  /** آبجکت proxy برای Clash/Mihomo — اگر ترکیب پشتیبانی نشود null. */
  generateClashProxy(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> | null;
  /** کانفیگ عمومی کلاینت برای نمایش در پنل. */
  generateClientConfig(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown>;
}

export const DEFAULT_SS_METHOD = 'aes-128-gcm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function commonIssues(node: ProxyNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!node.hostname || node.hostname.length < 3) {
    issues.push({ field: 'hostname', message: 'میزبان (hostname) نامعتبر است.' });
  }
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    issues.push({ field: 'port', message: 'پورت باید بین ۱ تا ۶۵۵۳۵ باشد.' });
  }
  if (node.transport.kind === 'ws' && node.transport.path && !node.transport.path.startsWith('/')) {
    issues.push({ field: 'transport.path', message: 'مسیر WebSocket باید با / آغاز شود.' });
  }
  if (node.transport.kind === 'grpc' && !node.transport.serviceName) {
    issues.push({ field: 'transport.serviceName', message: 'نام سرویس gRPC الزامی است.' });
  }
  if (node.tls.mode === 'tls' && !node.tls.sni && !node.hostname) {
    issues.push({ field: 'tls.sni', message: 'برای TLS مقدار SNI لازم است.' });
  }
  if (node.kind === 'cloudflare-edge' && node.tls.mode !== 'tls') {
    issues.push({ field: 'tls.mode', message: 'endpointهای Cloudflare باید از TLS استفاده کنند.' });
  }
  return issues;
}

function transportQuery(node: ProxyNode): Record<string, string> {
  const query: Record<string, string> = { type: node.transport.kind };
  if (node.transport.kind === 'ws') {
    if (node.transport.path) query.path = node.transport.path;
    if (node.transport.host ?? node.hostname) query.host = node.transport.host ?? node.hostname;
  }
  if (node.transport.kind === 'grpc') {
    if (node.transport.serviceName) query.serviceName = node.transport.serviceName;
    if (node.transport.mode) query.mode = node.transport.mode;
  }
  if (node.transport.kind === 'xhttp') {
    if (node.transport.path) query.path = node.transport.path;
    if (node.transport.host ?? node.hostname) query.host = node.transport.host ?? node.hostname;
    query.mode = node.transport.mode ?? 'auto';
  }
  if (node.tls.mode === 'tls') {
    query.security = 'tls';
    query.sni = node.tls.sni ?? node.hostname;
    if (node.tls.fingerprint) query.fp = node.tls.fingerprint;
    if (node.tls.alpn && node.tls.alpn.length > 0) query.alpn = node.tls.alpn.join(',');
    if (node.tls.allowInsecure) query.allowInsecure = '1';
  } else {
    query.security = 'none';
  }
  return query;
}

function buildQueryString(query: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params.toString();
}

function clashTransportFields(node: ProxyNode): Record<string, unknown> | null {
  switch (node.transport.kind) {
    case 'ws':
      return {
        network: 'ws',
        'ws-opts': {
          path: node.transport.path ?? '/',
          headers: { Host: node.transport.host ?? node.hostname },
        },
      };
    case 'grpc':
      return {
        network: 'grpc',
        'grpc-opts': { 'grpc-service-name': node.transport.serviceName ?? '' },
      };
    case 'xhttp':
      // Clash/Mihomo برای xhttp پشتیبانی استاندارد ندارد — این Node در خروجی Clash حذف می‌شود.
      return null;
    default:
      return null;
  }
}

function clashTlsFields(node: ProxyNode): Record<string, unknown> {
  if (node.tls.mode !== 'tls') return { tls: false };
  const fields: Record<string, unknown> = {
    tls: true,
    servername: node.tls.sni ?? node.hostname,
    'skip-cert-verify': Boolean(node.tls.allowInsecure),
  };
  if (node.tls.fingerprint) fields['client-fingerprint'] = node.tls.fingerprint;
  if (node.tls.alpn && node.tls.alpn.length > 0) fields.alpn = node.tls.alpn;
  return fields;
}

class VlessAdapter implements ProtocolAdapter {
  readonly key: ProtocolKey = 'vless';

  getMetadata(): ProtocolMetadata {
    return {
      key: 'vless',
      labelFa: 'VLESS',
      supportedTransports: ['ws', 'grpc', 'xhttp'],
      requiresTls: false,
      edgeRuntimeSupported: true,
      credentialLabelFa: 'شناسه UUID',
    };
  }

  validate(node: ProxyNode): ValidationResult {
    const issues = commonIssues(node);
    if (node.kind === 'cloudflare-edge' && node.transport.kind !== 'ws') {
      issues.push({
        field: 'transport.kind',
        message: 'Worker لبهٔ افرا فقط WebSocket را اجرا می‌کند.',
      });
    }
    return { valid: issues.length === 0, issues };
  }

  generateSubscriptionEntry(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): string {
    const query = { ...transportQuery(node), encryption: 'none' };
    const host = node.hostname;
    return `vless://${creds.uuid}@${host}:${node.port}?${buildQueryString(query)}#${encodeURIComponent(displayName)}`;
  }

  generateClashProxy(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> | null {
    const transport = clashTransportFields(node);
    if (!transport) return null;
    return {
      name: displayName,
      type: 'vless',
      server: node.hostname,
      port: node.port,
      uuid: creds.uuid,
      udp: true,
      ...transport,
      ...clashTlsFields(node),
    };
  }

  generateClientConfig(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> {
    return {
      name: displayName,
      protocol: 'vless',
      address: node.hostname,
      port: node.port,
      uuid: creds.uuid,
      transport: node.transport,
      tls: node.tls,
      uri: this.generateSubscriptionEntry(node, creds, displayName),
    };
  }
}

class TrojanAdapter implements ProtocolAdapter {
  readonly key: ProtocolKey = 'trojan';

  getMetadata(): ProtocolMetadata {
    return {
      key: 'trojan',
      labelFa: 'Trojan',
      supportedTransports: ['ws', 'grpc'],
      requiresTls: true,
      // Trojan نیازمند SHA-224 است که در WebCrypto ورکرها موجود نیست؛
      // بنابراین روی Worker لبهٔ افرا اجرا نمی‌شود و فقط برای Nodeهای بیرونی است.
      edgeRuntimeSupported: false,
      credentialLabelFa: 'گذرواژه Trojan',
    };
  }

  validate(node: ProxyNode): ValidationResult {
    const issues = commonIssues(node);
    if (node.tls.mode !== 'tls') {
      issues.push({ field: 'tls.mode', message: 'پروتکل Trojan نیازمند TLS است.' });
    }
    if (node.transport.kind === 'xhttp') {
      issues.push({ field: 'transport.kind', message: 'Trojan از xhttp پشتیبانی نمی‌کند.' });
    }
    if (node.kind === 'cloudflare-edge') {
      issues.push({
        field: 'kind',
        message: 'Trojan روی Worker لبهٔ افرا اجرا نمی‌شود؛ از Node بیرونی استفاده کنید.',
      });
    }
    return { valid: issues.length === 0, issues };
  }

  generateSubscriptionEntry(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): string {
    const query = transportQuery(node);
    return `trojan://${encodeURIComponent(creds.trojanPassword)}@${node.hostname}:${node.port}?${buildQueryString(query)}#${encodeURIComponent(displayName)}`;
  }

  generateClashProxy(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> | null {
    const transport = clashTransportFields(node);
    if (!transport) return null;
    const tls = clashTlsFields(node);
    delete (tls as Record<string, unknown>).tls;
    delete (tls as Record<string, unknown>).servername;
    return {
      name: displayName,
      type: 'trojan',
      server: node.hostname,
      port: node.port,
      password: creds.trojanPassword,
      udp: true,
      sni: node.tls.sni ?? node.hostname,
      ...transport,
      ...tls,
    };
  }

  generateClientConfig(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> {
    return {
      name: displayName,
      protocol: 'trojan',
      address: node.hostname,
      port: node.port,
      password: creds.trojanPassword,
      transport: node.transport,
      tls: node.tls,
      uri: this.generateSubscriptionEntry(node, creds, displayName),
    };
  }
}

class ShadowsocksAdapter implements ProtocolAdapter {
  readonly key: ProtocolKey = 'shadowsocks';

  getMetadata(): ProtocolMetadata {
    return {
      key: 'shadowsocks',
      labelFa: 'Shadowsocks',
      supportedTransports: ['ws'],
      requiresTls: false,
      // اجرای AEAD در Worker لبه پیاده‌سازی نشده؛ فقط برای Nodeهای بیرونی.
      edgeRuntimeSupported: false,
      credentialLabelFa: 'گذرواژه Shadowsocks',
    };
  }

  validate(node: ProxyNode): ValidationResult {
    const issues = commonIssues(node);
    if (node.kind === 'cloudflare-edge') {
      issues.push({
        field: 'kind',
        message: 'Shadowsocks روی Worker لبهٔ افرا اجرا نمی‌شود؛ از Node بیرونی استفاده کنید.',
      });
    }
    return { valid: issues.length === 0, issues };
  }

  generateSubscriptionEntry(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): string {
    const method = creds.ssMethod ?? DEFAULT_SS_METHOD;
    const userInfo = utf8ToBase64(`${method}:${creds.ssPassword}`)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const params = new URLSearchParams();
    if (node.transport.kind === 'ws') {
      const pluginOpts = [
        'v2ray-plugin',
        node.tls.mode === 'tls' ? 'tls' : '',
        `host=${node.transport.host ?? node.hostname}`,
        `path=${node.transport.path ?? '/'}`,
      ].filter(Boolean);
      params.set('plugin', pluginOpts.join(';'));
    }
    const query = params.toString();
    return `ss://${userInfo}@${node.hostname}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(displayName)}`;
  }

  generateClashProxy(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> | null {
    const proxy: Record<string, unknown> = {
      name: displayName,
      type: 'ss',
      server: node.hostname,
      port: node.port,
      cipher: creds.ssMethod ?? DEFAULT_SS_METHOD,
      password: creds.ssPassword,
      udp: true,
    };
    if (node.transport.kind === 'ws') {
      proxy.plugin = 'v2ray-plugin';
      proxy['plugin-opts'] = {
        mode: 'websocket',
        tls: node.tls.mode === 'tls',
        host: node.transport.host ?? node.hostname,
        path: node.transport.path ?? '/',
      };
    }
    return proxy;
  }

  generateClientConfig(
    node: ProxyNode,
    creds: ClientCredentials,
    displayName: string,
  ): Record<string, unknown> {
    return {
      name: displayName,
      protocol: 'shadowsocks',
      address: node.hostname,
      port: node.port,
      method: creds.ssMethod ?? DEFAULT_SS_METHOD,
      password: creds.ssPassword,
      transport: node.transport,
      uri: this.generateSubscriptionEntry(node, creds, displayName),
    };
  }
}

/** رجیستری adapterها — افزودن پروتکل جدید فقط با ثبت در این نقشه انجام می‌شود. */
const REGISTRY = new Map<ProtocolKey, ProtocolAdapter>([
  ['vless', new VlessAdapter()],
  ['trojan', new TrojanAdapter()],
  ['shadowsocks', new ShadowsocksAdapter()],
]);

export function getProtocolAdapter(key: ProtocolKey): ProtocolAdapter {
  const adapter = REGISTRY.get(key);
  if (!adapter) throw new Error(`protocol adapter not found: ${key}`);
  return adapter;
}

export function listProtocolAdapters(): ProtocolAdapter[] {
  return [...REGISTRY.values()];
}

export function listProtocolMetadata(): ProtocolMetadata[] {
  return listProtocolAdapters().map((adapter) => adapter.getMetadata());
}

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const TRANSPORT_LABELS_FA: Record<TransportKey, string> = {
  ws: 'WebSocket',
  grpc: 'gRPC',
  xhttp: 'XHTTP',
};
