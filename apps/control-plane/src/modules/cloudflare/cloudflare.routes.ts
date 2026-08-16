import { AfraError, cfDnsRecordSchema, cfEndpointDeploySchema, cloudflareSettingsSchema } from '@afra/shared';
import { Hono } from 'hono';
import { buildEndpointScript, ENDPOINT_SCRIPT_VERSION } from '../../cloudflare/endpoint-script.js';
import { resolveCloudflareCredentials, requireCloudflareClient } from '../../cloudflare/resolve.js';
import { writeAudit } from '../../core/audit.js';
import type { AppEnv } from '../../core/context.js';
import { encryptSecret } from '../../core/crypto.js';
import { newId, nowIso } from '../../core/ids.js';
import { requireAuth, requirePermission } from '../../core/middleware.js';
import { jsonOk } from '../../core/response.js';
import { parseJson, requireParam } from '../../core/validate.js';
import { getNode, updateNode } from '../nodes/nodes.service.js';

export const cloudflareRouter = new Hono<AppEnv>();
cloudflareRouter.use('*', requireAuth);

const DEFAULT_D1_NAME = 'afra-db';
const DEFAULT_KV_TITLE = 'afra-kv';

/** وضعیت اتصال Cloudflare — بدون افشای توکن. */
cloudflareRouter.get('/status', requirePermission('cloudflare.read'), async (c) => {
  const settings = c.get('settings');
  const credentials = await resolveCloudflareCredentials(c.env, settings);
  if (!credentials) {
    return jsonOk({
      configured: false,
      healthy: false,
      accountId: null,
      source: null,
      message: 'اعتبارنامهٔ Cloudflare تنظیم نشده است.',
    });
  }

  try {
    const { client } = await requireCloudflareClient(c.env, settings);
    const token = await client.verifyToken();
    const subdomain = await client.getWorkersSubdomain();
    return jsonOk({
      configured: true,
      healthy: token.status === 'active',
      accountId: credentials.accountId,
      source: credentials.source,
      tokenStatus: token.status,
      workersSubdomain: subdomain,
      scriptVersion: ENDPOINT_SCRIPT_VERSION,
    });
  } catch (error) {
    return jsonOk({
      configured: true,
      healthy: false,
      accountId: credentials.accountId,
      source: credentials.source,
      message: error instanceof AfraError ? error.message : 'ارتباط با Cloudflare برقرار نشد.',
    });
  }
});

/** ذخیرهٔ اعتبارنامه در تنظیمات (رمزنگاری‌شده). ترجیح: استفاده از wrangler secret. */
cloudflareRouter.put('/settings', requirePermission('cloudflare.manage'), async (c) => {
  const input = await parseJson(c, cloudflareSettingsSchema);
  const settings = c.get('settings');

  if (input.accountId !== undefined && input.accountId !== null) {
    await settings.set('cloudflareAccountId', input.accountId);
  }
  if (input.defaultZoneId !== undefined && input.defaultZoneId !== null) {
    await settings.set('cloudflareDefaultZoneId', input.defaultZoneId);
  }
  if (input.apiToken) {
    await settings.set(
      'cloudflareApiToken',
      await encryptSecret(input.apiToken, c.env.AFRA_SECRET_KEY),
      true,
    );
  }

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'cloudflare.settings.updated',
    resource: 'cloudflare',
    ip: c.get('clientIp'),
    metadata: { tokenRotated: Boolean(input.apiToken) },
  });
  return jsonOk({ saved: true });
});

cloudflareRouter.get('/resources', requirePermission('cloudflare.read'), async (c) => {
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  const [workers, kv, d1, r2] = await Promise.all([
    client.listWorkerScripts().catch(() => []),
    client.listKvNamespaces().catch(() => []),
    client.listD1Databases().catch(() => []),
    client.listR2Buckets().catch(() => []),
  ]);
  return jsonOk({
    workers: workers.map((worker) => ({ name: worker.id, modifiedOn: worker.modified_on ?? null })),
    kvNamespaces: kv.map((ns) => ({ id: ns.id, title: ns.title })),
    d1Databases: d1.map((db) => ({ id: db.uuid, name: db.name })),
    r2Buckets: r2.map((bucket) => ({ name: bucket.name })),
  });
});

cloudflareRouter.get('/zones', requirePermission('cloudflare.read'), async (c) => {
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  const zones = await client.listZones();
  return jsonOk({ items: zones.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status })) });
});

cloudflareRouter.get('/zones/:zoneId/dns', requirePermission('cloudflare.read'), async (c) => {
  const zoneId = requireParam(c, 'zoneId');
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  const records = await client.listDnsRecords(zoneId);
  return jsonOk({ items: records });
});

cloudflareRouter.post('/dns', requirePermission('cloudflare.manage'), async (c) => {
  const input = await parseJson(c, cfDnsRecordSchema);
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  const record = await client.createDnsRecord(input.zoneId, {
    type: input.type,
    name: input.name,
    content: input.content,
    proxied: input.proxied,
    ttl: input.ttl,
  });

  await c.env.AFRA_DB.prepare(
    'INSERT INTO cf_resources (id, kind, cf_id, name, zone_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      newId('cfr'),
      'dns_record',
      record.id,
      record.name,
      input.zoneId,
      JSON.stringify({ type: record.type, proxied: record.proxied }),
      nowIso(),
    )
    .run();

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'cloudflare.dns.created',
    resource: 'dns_record',
    resourceId: record.id,
    ip: c.get('clientIp'),
    metadata: { name: record.name, type: record.type },
  });
  return jsonOk({ record }, 201);
});

cloudflareRouter.delete('/zones/:zoneId/dns/:recordId', requirePermission('cloudflare.manage'), async (c) => {
  const zoneId = requireParam(c, 'zoneId');
  const recordId = requireParam(c, 'recordId');
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  await client.deleteDnsRecord(zoneId, recordId);
  await c.env.AFRA_DB.prepare('DELETE FROM cf_resources WHERE cf_id = ? AND kind = ?')
    .bind(recordId, 'dns_record')
    .run();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'cloudflare.dns.deleted',
    resource: 'dns_record',
    resourceId: recordId,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

/**
 * انتشار واقعی endpoint روی Cloudflare Workers برای یک Node.
 * اسکریپت تولیدشده به همان D1 و KV پنل bind می‌شود تا احراز هویت و
 * شمارش ترافیک روی داده‌های واقعی انجام گیرد.
 */
cloudflareRouter.post('/endpoints/deploy', requirePermission('cloudflare.manage'), async (c) => {
  const input = await parseJson(c, cfEndpointDeploySchema);
  const settings = c.get('settings');
  const config = await settings.load();
  const { client } = await requireCloudflareClient(c.env, settings);

  const node = await getNode(c.env, input.nodeId);
  if (!node) throw new AfraError('NODE_NOT_FOUND', 404);
  if (node.kind !== 'cloudflare-edge') {
    throw new AfraError('VALIDATION_ERROR', 422, {
      reason: 'node_not_cloudflare',
      message: 'فقط Nodeهای نوع Cloudflare قابل انتشار هستند.',
    });
  }
  if (node.protocol !== 'vless' || node.transport.kind !== 'ws') {
    throw new AfraError('VALIDATION_ERROR', 422, {
      reason: 'unsupported_combination',
      message: 'endpoint لبهٔ Cloudflare فقط VLESS روی WebSocket را اجرا می‌کند.',
    });
  }

  const d1Name = await settings.getRaw<string>('cloudflareD1Name', DEFAULT_D1_NAME);
  const kvTitle = await settings.getRaw<string>('cloudflareKvTitle', DEFAULT_KV_TITLE);

  const [databases, namespaces] = await Promise.all([
    client.listD1Databases(),
    client.listKvNamespaces(),
  ]);
  const database = databases.find((db) => db.name === d1Name);
  const namespace = namespaces.find((ns) => ns.title === kvTitle || ns.title.includes(kvTitle));

  if (!namespace) {
    throw new AfraError('VALIDATION_ERROR', 422, {
      reason: 'kv_not_found',
      expected: kvTitle,
      message: `فضای KV با نام «${kvTitle}» پیدا نشد. ابتدا آن را بسازید یا نام را در تنظیمات اصلاح کنید.`,
    });
  }

  const script = buildEndpointScript({ path: node.transport.path ?? '/afra' });
  const bindings = [
    { type: 'kv_namespace' as const, name: 'AFRA_KV', namespace_id: namespace.id },
    ...(database ? [{ type: 'd1' as const, name: 'AFRA_DB', id: database.uuid }] : []),
  ];

  await client.uploadWorkerScript({ scriptName: input.scriptName, script, bindings });
  await client.enableWorkersDevSubdomain(input.scriptName).catch(() => undefined);
  const subdomain = await client.getWorkersSubdomain();

  let hostname = subdomain ? `${input.scriptName}.${subdomain}.workers.dev` : node.hostname;
  let routePattern: string | null = null;

  if (input.routeHost && input.zoneId) {
    routePattern = `${input.routeHost}/*`;
    const route = await client.createWorkerRoute(input.zoneId, routePattern, input.scriptName);
    hostname = input.routeHost;
    await c.env.AFRA_DB.prepare(
      'INSERT INTO cf_resources (id, kind, cf_id, name, zone_id, node_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        newId('cfr'),
        'route',
        route.id,
        routePattern,
        input.zoneId,
        node.id,
        JSON.stringify({ script: input.scriptName }),
        nowIso(),
      )
      .run();
  }

  await c.env.AFRA_DB.prepare(
    'INSERT INTO cf_resources (id, kind, cf_id, name, node_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      newId('cfr'),
      'worker',
      input.scriptName,
      input.scriptName,
      node.id,
      JSON.stringify({ hostname, scriptVersion: ENDPOINT_SCRIPT_VERSION, d1Bound: Boolean(database) }),
      nowIso(),
    )
    .run();

  await updateNode(c.env, node.id, {
    hostname,
    cfWorkerName: input.scriptName,
    cfRouteHost: input.routeHost ?? null,
    tls: {
      mode: 'tls',
      sni: hostname,
      alpn: node.tls.alpn ?? null,
      fingerprint: node.tls.fingerprint ?? ('chrome' as const),
      minVersion: node.tls.minVersion ?? '1.3',
      allowInsecure: false,
    },
  });

  // آماده‌سازی allowlist روی KV تا endpoint بدون تأخیر کار کند
  const synced = await primeUserAllowlist(c.env);

  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'cloudflare.endpoint.deployed',
    resource: 'node',
    resourceId: node.id,
    ip: c.get('clientIp'),
    metadata: { scriptName: input.scriptName, hostname, routePattern, syncedUsers: synced },
  });

  return jsonOk({
    deployed: true,
    hostname,
    scriptName: input.scriptName,
    routePattern,
    d1Bound: Boolean(database),
    kvNamespace: namespace.title,
    syncedUsers: synced,
    warning: database
      ? null
      : `دیتابیس D1 با نام «${d1Name}» پیدا نشد؛ endpoint فقط با کش KV کار می‌کند.`,
    panelName: config.panelName,
  });
});

cloudflareRouter.delete('/endpoints/:scriptName', requirePermission('cloudflare.manage'), async (c) => {
  const scriptName = requireParam(c, 'scriptName');
  const { client } = await requireCloudflareClient(c.env, c.get('settings'));
  await client.deleteWorkerScript(scriptName);
  await c.env.AFRA_DB.prepare('DELETE FROM cf_resources WHERE kind = ? AND cf_id = ?')
    .bind('worker', scriptName)
    .run();
  await writeAudit(c.env, {
    adminId: c.get('auth')?.adminId,
    adminUsername: c.get('auth')?.username,
    action: 'cloudflare.endpoint.deleted',
    resource: 'worker',
    resourceId: scriptName,
    ip: c.get('clientIp'),
  });
  return jsonOk({ deleted: true });
});

cloudflareRouter.get('/endpoints', requirePermission('cloudflare.read'), async (c) => {
  const rows = await c.env.AFRA_DB.prepare(
    'SELECT id, kind, cf_id, name, zone_id, node_id, metadata, created_at FROM cf_resources ORDER BY created_at DESC LIMIT 200',
  ).all<{
    id: string;
    kind: string;
    cf_id: string | null;
    name: string;
    zone_id: string | null;
    node_id: string | null;
    metadata: string | null;
    created_at: string;
  }>();
  return jsonOk({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      cfId: row.cf_id,
      name: row.name,
      zoneId: row.zone_id,
      nodeId: row.node_id,
      metadata: row.metadata ? (JSON.parse(row.metadata) as unknown) : null,
      createdAt: row.created_at,
    })),
  });
});

/** هم‌گام‌سازی allowlist کاربران با KV (برای endpointهای منتشرشده). */
cloudflareRouter.post('/sync-users', requirePermission('cloudflare.manage'), async (c) => {
  const synced = await primeUserAllowlist(c.env);
  return jsonOk({ synced });
});

async function primeUserAllowlist(env: AppEnv['Bindings'], limit = 1000): Promise<number> {
  const rows = await env.AFRA_DB.prepare(
    `SELECT id, credential_uuid, enabled, quota_bytes, used_bytes, expires_at
       FROM users ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string;
      credential_uuid: string;
      enabled: number;
      quota_bytes: number | null;
      used_bytes: number;
      expires_at: string | null;
    }>();

  let synced = 0;
  for (const row of rows.results ?? []) {
    const expired = row.expires_at ? Date.parse(row.expires_at) <= Date.now() : false;
    const exhausted = row.quota_bytes !== null && (row.used_bytes ?? 0) >= row.quota_bytes;
    const allowed = row.enabled === 1 && !expired && !exhausted;
    await env.AFRA_KV.put(
      `edge:user:${row.credential_uuid.toLowerCase()}`,
      JSON.stringify({ allowed, userId: row.id }),
      { expirationTtl: 300 },
    ).catch(() => undefined);
    synced += 1;
  }
  return synced;
}

export { primeUserAllowlist };
