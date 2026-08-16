import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  apiGet,
  apiPost,
  authedRequest,
  bootstrapAdmin,
  json,
  login,
  resetDatabase,
} from './helpers.js';
import type { Session } from './helpers.js';

const NODE = {
  name: 'هلند یک',
  kind: 'cloudflare-edge',
  country: 'NL',
  city: 'Amsterdam',
  hostname: 'nl.afra.test',
  port: 443,
  protocol: 'vless',
  transport: { kind: 'ws', path: '/afra' },
  tls: { mode: 'tls', fingerprint: 'chrome' },
  priority: 1,
  weight: 60,
  enabled: true,
};

describe('سرورها (Nodes)', () => {
  let session: Session;
  beforeEach(async () => {
    await resetDatabase();
    session = await bootstrapAdmin();
  });

  it('Node ساخته می‌شود و پرچم از کد کشور استخراج می‌گردد', async () => {
    const created = await apiPost<{ node: { id: string; flag: string; health: string } }>(
      session,
      '/api/v1/nodes',
      NODE,
      201,
    );
    expect(created.node.flag).toBe('🇳🇱');
    expect(created.node.health).toBe('unknown');
  });

  it('ترکیب پروتکل ناسازگار با لبهٔ Cloudflare رد می‌شود', async () => {
    const response = await authedRequest(session, '/api/v1/nodes', {
      method: 'POST',
      body: JSON.stringify({ ...NODE, protocol: 'shadowsocks' }),
    });
    expect(response.status).toBe(422);
    const body = await json<{ error: { code: string; details: { issues: { field: string }[] } } }>(
      response,
    );
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('میزبان نامعتبر توسط اعتبارسنجی رد می‌شود', async () => {
    const response = await authedRequest(session, '/api/v1/nodes', {
      method: 'POST',
      body: JSON.stringify({ ...NODE, hostname: 'not a hostname' }),
    });
    expect(response.status).toBe(422);
  });

  it('فراداده پروتکل‌ها شامل قابلیت اجرای لبه است', async () => {
    const meta = await apiGet<{
      protocols: { key: string; edgeRuntimeSupported: boolean }[];
      transports: { key: string }[];
    }>(session, '/api/v1/nodes/meta');
    const vless = meta.protocols.find((item) => item.key === 'vless');
    const trojan = meta.protocols.find((item) => item.key === 'trojan');
    expect(vless?.edgeRuntimeSupported).toBe(true);
    expect(trojan?.edgeRuntimeSupported).toBe(false);
    expect(meta.transports.map((item) => item.key)).toContain('grpc');
  });

  it('ویرایش و حذف Node کار می‌کند', async () => {
    const created = await apiPost<{ node: { id: string } }>(session, '/api/v1/nodes', NODE, 201);
    const patch = await authedRequest(session, `/api/v1/nodes/${created.node.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'هلند دو', weight: 90 }),
    });
    expect(patch.status).toBe(200);
    const updated = await json<{ data: { node: { name: string; weight: number } } }>(patch);
    expect(updated.data.node.name).toBe('هلند دو');
    expect(updated.data.node.weight).toBe(90);

    const removed = await authedRequest(session, `/api/v1/nodes/${created.node.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    const after = await authedRequest(session, `/api/v1/nodes/${created.node.id}`);
    expect(after.status).toBe(404);
  });

  it('پیش‌نمایش توازن بار، Nodeها را مرتب می‌کند', async () => {
    await apiPost(session, '/api/v1/nodes', NODE, 201);
    await apiPost(
      session,
      '/api/v1/nodes',
      { ...NODE, name: 'آلمان', hostname: 'de.afra.test', priority: 2 },
      201,
    );
    await env.AFRA_DB.prepare("UPDATE nodes SET health = 'healthy', latency_ms = 90 WHERE hostname = ?")
      .bind('de.afra.test')
      .run();
    await env.AFRA_DB.prepare("UPDATE nodes SET health = 'healthy', latency_ms = 300 WHERE hostname = ?")
      .bind('nl.afra.test')
      .run();

    const preview = await apiGet<{ strategy: string; order: { name: string; rank: number }[] }>(
      session,
      '/api/v1/nodes/balance-preview',
    );
    expect(preview.strategy).toBe('latency');
    expect(preview.order[0]?.name).toBe('آلمان');
  });
});

describe('کنترل دسترسی نقش‌محور', () => {
  let superSession: Session;
  beforeEach(async () => {
    await resetDatabase();
    superSession = await bootstrapAdmin();
  });

  it('نقش فقط‌خواندنی اجازهٔ نوشتن ندارد', async () => {
    await apiPost(
      superSession,
      '/api/v1/settings/admins',
      {
        username: 'viewer',
        password: 'ViewerPass-2026x',
        role: 'read_only',
      },
      201,
    );

    const viewer = await login('viewer', 'ViewerPass-2026x');
    expect(viewer.response.status).toBe(200);

    const readOk = await authedRequest(viewer.session!, '/api/v1/users');
    expect(readOk.status).toBe(200);

    const writeDenied = await authedRequest(viewer.session!, '/api/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'کاربر تست', username: 'denied-user' }),
    });
    expect(writeDenied.status).toBe(403);
    const body = await json<{ error: { code: string; details: { required: string } } }>(writeDenied);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details.required).toBe('users.write');
  });

  it('نقش admin به مدیریت مدیران دسترسی ندارد', async () => {
    await apiPost(
      superSession,
      '/api/v1/settings/admins',
      { username: 'operator', password: 'OperatorPass-2026x', role: 'admin' },
      201,
    );
    const operator = await login('operator', 'OperatorPass-2026x');
    const denied = await authedRequest(operator.session!, '/api/v1/settings/admins');
    expect(denied.status).toBe(403);
  });

  it('حذف تنها مدیر ارشد مجاز نیست', async () => {
    const admins = await apiGet<{ items: { id: string; role: string }[] }>(
      superSession,
      '/api/v1/settings/admins',
    );
    const target = admins.items.find((item) => item.role === 'super_admin');
    // حذف حساب خود مدیر نیز مسدود است
    const response = await authedRequest(superSession, `/api/v1/settings/admins/${target?.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(400);
  });
});

describe('مسیریابی، DNS و تنظیمات', () => {
  let session: Session;
  beforeEach(async () => {
    await resetDatabase();
    session = await bootstrapAdmin();
  });

  it('قواعد پیش‌فرض موجود است و قاعدهٔ جدید افزوده می‌شود', async () => {
    const initial = await apiGet<{ items: { id: string }[]; clashPreview: string[] }>(
      session,
      '/api/v1/routing/rules',
    );
    expect(initial.items.length).toBeGreaterThan(0);
    expect(initial.clashPreview.length).toBeGreaterThan(0);

    const created = await apiPost<{ id: string }>(
      session,
      '/api/v1/routing/rules',
      {
        name: 'بلاک تبلیغات',
        type: 'domain-keyword',
        pattern: 'doubleclick',
        action: 'block',
        priority: 5,
      },
      201,
    );
    expect(created.id).toBeTruthy();

    const after = await apiGet<{ clashPreview: string[] }>(session, '/api/v1/routing/rules');
    expect(after.clashPreview.join('\n')).toContain('DOMAIN-KEYWORD,doubleclick,REJECT');
  });

  it('الگوی نامعتبر CIDR رد می‌شود', async () => {
    const response = await authedRequest(session, '/api/v1/routing/rules', {
      method: 'POST',
      body: JSON.stringify({ name: 'بد', type: 'cidr', pattern: '10.0.0.0', action: 'direct' }),
    });
    expect(response.status).toBe(422);
  });

  it('خروجی و ورودی قواعد کار می‌کند', async () => {
    const exported = await apiGet<{ rules: unknown[] }>(session, '/api/v1/routing/export');
    expect(exported.rules.length).toBeGreaterThan(0);

    const imported = await apiPost<{ imported: number }>(session, '/api/v1/routing/import', {
      rules: [
        { name: 'وارد شده', type: 'domain-suffix', pattern: 'example.org', action: 'proxy', priority: 50 },
      ],
      replace: true,
    });
    expect(imported.imported).toBe(1);

    const after = await apiGet<{ items: { name: string }[] }>(session, '/api/v1/routing/rules');
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.name).toBe('وارد شده');
  });

  it('سرور DNS افزوده می‌شود و URI درست تولید می‌گردد', async () => {
    await apiPost(
      session,
      '/api/v1/dns/servers',
      { name: 'کوئد۹', kind: 'doh', address: 'https://dns.quad9.net/dns-query', isFallback: true },
      201,
    );
    const list = await apiGet<{ items: { name: string; uri: string }[] }>(
      session,
      '/api/v1/dns/servers',
    );
    const quad9 = list.items.find((item) => item.name === 'کوئد۹');
    expect(quad9?.uri).toBe('https://dns.quad9.net/dns-query');
  });

  it('فیلتر دامنه با حذف تکراری‌ها ذخیره می‌شود', async () => {
    const created = await apiPost<{ entryCount: number }>(
      session,
      '/api/v1/dns/filters',
      {
        name: 'لیست تبلیغات',
        kind: 'ads',
        entries: ['Ads.example.com', 'ads.example.com', 'tracker.example.net'],
      },
      201,
    );
    expect(created.entryCount).toBe(2);
  });

  it('تنظیمات به‌روزرسانی و اعمال می‌شود', async () => {
    const updated = await authedRequest(session, '/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ balanceStrategy: 'weight', panelName: 'افرای من', enableIpv6: true }),
    });
    expect(updated.status).toBe(200);

    const settings = await apiGet<{ settings: { balanceStrategy: string; panelName: string } }>(
      session,
      '/api/v1/settings',
    );
    expect(settings.settings.balanceStrategy).toBe('weight');
    expect(settings.settings.panelName).toBe('افرای من');

    const preview = await apiGet<{ strategy: string }>(session, '/api/v1/nodes/balance-preview');
    expect(preview.strategy).toBe('weight');
  });

  it('مقدار نامعتبر تنظیمات رد می‌شود', async () => {
    const response = await authedRequest(session, '/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ balanceStrategy: 'invalid-strategy' }),
    });
    expect(response.status).toBe(422);
  });
});

describe('زنجیرهٔ پروکسی و بک‌اند', () => {
  let session: Session;
  beforeEach(async () => {
    await resetDatabase();
    session = await bootstrapAdmin();
  });

  it('زنجیره با Node ناموجود نامعتبر است', async () => {
    const result = await apiPost<{ valid: boolean; issues: { message: string }[] }>(
      session,
      '/api/v1/proxy-chains/validate',
      {
        name: 'زنجیرهٔ تست',
        hops: [
          { kind: 'node', nodeId: 'nod_missing' },
          { kind: 'socks5', host: '10.0.0.1', port: 1080 },
        ],
      },
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('وجود ندارد');
  });

  it('زنجیرهٔ معتبر ذخیره می‌شود', async () => {
    const node = await apiPost<{ node: { id: string } }>(session, '/api/v1/nodes', NODE, 201);
    const created = await apiPost<{ id: string }>(
      session,
      '/api/v1/proxy-chains',
      {
        name: 'زنجیرهٔ اصلی',
        hops: [
          { kind: 'node', nodeId: node.node.id },
          { kind: 'socks5', host: '10.0.0.1', port: 1080 },
        ],
      },
      201,
    );
    expect(created.id).toBeTruthy();

    const list = await apiGet<{ items: { name: string; hops: unknown[] }[] }>(
      session,
      '/api/v1/proxy-chains',
    );
    expect(list.items[0]?.hops).toHaveLength(2);
  });

  it('راز بک‌اند هرگز بازگردانده نمی‌شود', async () => {
    await apiPost(
      session,
      '/api/v1/backends',
      {
        name: 'بک‌اند اصلی',
        url: 'https://backend.example.com',
        authType: 'bearer',
        secret: 'super-secret-value',
      },
      201,
    );
    const response = await authedRequest(session, '/api/v1/backends');
    const text = await response.text();
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('"hasSecret":true');
  });
});

describe('Cloudflare، تلگرام و پشتیبان', () => {
  let session: Session;
  beforeEach(async () => {
    await resetDatabase();
    session = await bootstrapAdmin();
  });

  it('وضعیت Cloudflare بدون اعتبارنامه، پیکربندی‌نشده گزارش می‌شود', async () => {
    const status = await apiGet<{ configured: boolean; message?: string }>(
      session,
      '/api/v1/cloudflare/status',
    );
    expect(status.configured).toBe(false);
    expect(status.message).toContain('Cloudflare');
  });

  it('انتشار endpoint بدون اعتبارنامه خطای روشن می‌دهد (بدون شبیه‌سازی)', async () => {
    const node = await apiPost<{ node: { id: string } }>(session, '/api/v1/nodes', NODE, 201);
    const response = await authedRequest(session, '/api/v1/cloudflare/endpoints/deploy', {
      method: 'POST',
      body: JSON.stringify({ nodeId: node.node.id, scriptName: 'afra-endpoint-test' }),
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('CLOUDFLARE_NOT_CONFIGURED');
  });

  it('webhook تلگرام بدون فعال‌سازی رد می‌شود', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/telegram-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(404);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('TELEGRAM_NOT_CONFIGURED');
  });

  it('webhook تلگرام با راز نادرست رد می‌شود', async () => {
    await authedRequest(session, '/api/v1/telegram/settings', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        botToken: '123456:test-bot-token-value-for-tests',
        webhookSecret: 'webhook-secret-value',
      }),
    });

    const response = await SELF.fetch('https://afra.test/api/v1/telegram-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(403);
  });

  it('توکن ربات در پاسخ تنظیمات افشا نمی‌شود', async () => {
    await authedRequest(session, '/api/v1/telegram/settings', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        botToken: '123456:secret-bot-token',
        webhookSecret: 'webhook-secret-value',
      }),
    });
    const response = await authedRequest(session, '/api/v1/telegram/settings');
    const text = await response.text();
    expect(text).not.toContain('secret-bot-token');
    expect(text).toContain('"botTokenConfigured":true');
  });

  it('پشتیبان کامل رمزنگاری‌شده ساخته و بازگردانی می‌شود', async () => {
    await apiPost(session, '/api/v1/users', { name: 'کاربر پشتیبان', username: 'backup-user' }, 201);
    const created = await apiPost<{ backup: { id: string; key: string; encrypted: boolean } }>(
      session,
      '/api/v1/backup',
      { includeSecrets: true, encrypt: true, passphrase: 'backup-passphrase-123' },
      201,
    );
    expect(created.backup.encrypted).toBe(true);

    // حذف کاربر و سپس بازگردانی
    const users = await apiGet<{ items: { id: string }[] }>(session, '/api/v1/users');
    await authedRequest(session, `/api/v1/users/${users.items[0]?.id}`, { method: 'DELETE' });
    expect((await apiGet<{ total: number }>(session, '/api/v1/users')).total).toBe(0);

    const restored = await apiPost<{ report: { restored: Record<string, number> } }>(
      session,
      '/api/v1/backup/restore',
      { key: created.backup.key, passphrase: 'backup-passphrase-123', wipeExisting: false },
    );
    expect(restored.report.restored.users).toBe(1);
    expect((await apiGet<{ total: number }>(session, '/api/v1/users')).total).toBe(1);
  });

  it('بازگردانی با عبارت عبور نادرست ناموفق است', async () => {
    const created = await apiPost<{ backup: { key: string } }>(
      session,
      '/api/v1/backup',
      { includeSecrets: false, encrypt: true, passphrase: 'right-passphrase-123' },
      201,
    );
    const response = await authedRequest(session, '/api/v1/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ key: created.backup.key, passphrase: 'wrong-passphrase-123' }),
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('RESTORE_FAILED');
  });

  it('پشتیبان بدون اسرار، جداول اعتبارنامه‌ای را در بازگردانی رد می‌کند', async () => {
    await apiPost(session, '/api/v1/users', { name: 'کاربر بدون راز', username: 'nosecret-user' }, 201);
    const created = await apiPost<{ backup: { key: string } }>(
      session,
      '/api/v1/backup',
      { includeSecrets: false, encrypt: false },
      201,
    );
    const restored = await apiPost<{
      report: { restored: Record<string, number>; skipped: { table: string; reason: string }[] };
    }>(session, '/api/v1/backup/restore', { key: created.backup.key });

    expect(restored.report.restored.nodes ?? 0).toBeGreaterThanOrEqual(0);
    const usersSkip = restored.report.skipped.find((item) => item.table === 'users');
    expect(usersSkip?.reason).toBe('missing_secret_columns');
  });

  it('پشتیبان بدون اسرار، اعتبارنامه‌ها را در فایل خروجی ندارد', async () => {
    await apiPost(session, '/api/v1/users', { name: 'کاربر راز', username: 'secret-user' }, 201);
    const created = await apiPost<{ backup: { id: string } }>(
      session,
      '/api/v1/backup',
      { includeSecrets: false, encrypt: false },
      201,
    );
    const download = await authedRequest(session, `/api/v1/backup/${created.backup.id}/download`);
    const text = await download.text();
    expect(text).toContain('secret-user');
    expect(text).not.toContain('credential_uuid');
    expect(text).not.toContain('password_hash');
  });
});

describe('سلامت سرویس و تحلیل‌ها', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('endpointهای سلامت و آمادگی عمومی هستند', async () => {
    const health = await SELF.fetch('https://afra.test/health');
    expect(health.status).toBe(200);
    const ready = await SELF.fetch('https://afra.test/ready');
    expect(ready.status).toBe(200);
    const body = await json<{ data: { ready: boolean; database: string } }>(ready);
    expect(body.data.ready).toBe(true);
    expect(body.data.database).toBe('ok');
  });

  it('هدرهای امنیتی روی پاسخ‌ها تنظیم می‌شود', async () => {
    const response = await SELF.fetch('https://afra.test/health');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('آمار داشبورد از دادهٔ واقعی محاسبه می‌شود', async () => {
    const session = await bootstrapAdmin();
    await apiPost(session, '/api/v1/nodes', NODE, 201);
    await apiPost(session, '/api/v1/users', { name: 'کاربر آمار', username: 'stat-user', quota: '5GB' }, 201);
    await apiPost(
      session,
      '/api/v1/users',
      { name: 'کاربر غیرفعال', username: 'off-stat', enabled: false },
      201,
    );

    const overview = await apiGet<{
      stats: {
        users: { total: number; active: number; disabled: number };
        nodes: { total: number };
        cloudflare: { configured: boolean };
      };
      recentUsers: unknown[];
      recentEvents: unknown[];
    }>(session, '/api/v1/analytics/overview');

    expect(overview.stats.users.total).toBe(2);
    expect(overview.stats.users.active).toBe(1);
    expect(overview.stats.users.disabled).toBe(1);
    expect(overview.stats.nodes.total).toBe(1);
    expect(overview.recentUsers).toHaveLength(2);
    expect(overview.recentEvents.length).toBeGreaterThan(0);
  });

  it('سری زمانی ترافیک از نمونه‌های ثبت‌شده ساخته می‌شود', async () => {
    const session = await bootstrapAdmin();
    const created = await apiPost<{ user: { id: string } }>(
      session,
      '/api/v1/users',
      { name: 'کاربر ترافیک', username: 'traffic-user' },
      201,
    );
    await env.AFRA_DB.prepare(
      "INSERT INTO traffic_samples (id, user_id, node_id, bytes, bucket_at) VALUES ('trf_test', ?, NULL, 1048576, ?)",
    )
      .bind(created.user.id, new Date().toISOString().slice(0, 13) + ':00:00Z')
      .run();

    const traffic = await apiGet<{ series: { bytes: number }[]; topUsers: { username: string }[] }>(
      session,
      '/api/v1/analytics/traffic?range=24h',
    );
    expect(traffic.series.length).toBeGreaterThan(0);
    expect(traffic.topUsers[0]?.username).toBe('traffic-user');
  });

  it('مسیر ناشناختهٔ API خطای ۴۰۴ ساختاریافته برمی‌گرداند', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    const body = await json<{ ok: boolean; error: { code: string } }>(response);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
