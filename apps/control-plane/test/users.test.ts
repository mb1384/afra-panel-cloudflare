import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiGet, apiPost, authedRequest, bootstrapAdmin, json, resetDatabase } from './helpers.js';
import type { Session } from './helpers.js';

const NODE_PAYLOAD = {
  name: 'آلمان یک',
  kind: 'cloudflare-edge',
  country: 'DE',
  city: 'Frankfurt',
  hostname: 'edge.afra.test',
  port: 443,
  protocol: 'vless',
  transport: { kind: 'ws', path: '/afra' },
  tls: { mode: 'tls', fingerprint: 'chrome', minVersion: '1.3' },
  priority: 1,
  weight: 70,
  enabled: true,
};

describe('مدیریت کاربران و اشتراک', () => {
  let session: Session;

  beforeEach(async () => {
    await resetDatabase();
    session = await bootstrapAdmin();
  });

  it('کاربر ایجاد می‌شود و لینک اشتراک برمی‌گردد', async () => {
    const created = await apiPost<{
      user: { id: string; username: string; quotaBytes: number | null; state: string };
      subscription: { token: string; subscriptionUrl: string; clashUrl: string };
    }>(
      session,
      '/api/v1/users',
      { name: 'کاربر یک', username: 'user-one', quota: '10GB', expiresInDays: 30 },
      201,
    );

    expect(created.user.username).toBe('user-one');
    expect(created.user.quotaBytes).toBe(10 * 1024 ** 3);
    expect(created.user.state).toBe('active');
    expect(created.subscription.token.length).toBeGreaterThan(20);
    expect(created.subscription.subscriptionUrl).toContain('/sub/');
    expect(created.subscription.clashUrl).toContain('format=clash');
  });

  it('نام کاربری تکراری رد می‌شود', async () => {
    await apiPost(session, '/api/v1/users', { name: 'کاربر الف', username: 'dup-user' }, 201);
    const response = await authedRequest(session, '/api/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'کاربر ب', username: 'dup-user' }),
    });
    expect(response.status).toBe(409);
    const body = await json<{ error: { code: string; message: string } }>(response);
    expect(body.error.code).toBe('USERNAME_TAKEN');
    expect(body.error.message).toContain('نام کاربری');
  });

  it('فهرست کاربران با فیلتر وضعیت و جستجو کار می‌کند', async () => {
    await apiPost(session, '/api/v1/users', { name: 'فعال', username: 'active-user' }, 201);
    const disabled = await apiPost<{ user: { id: string } }>(
      session,
      '/api/v1/users',
      { name: 'غیرفعال', username: 'off-user', enabled: false },
      201,
    );
    expect(disabled.user.id).toBeTruthy();

    const all = await apiGet<{ total: number; items: unknown[] }>(session, '/api/v1/users');
    expect(all.total).toBe(2);

    const onlyDisabled = await apiGet<{ items: { username: string }[] }>(
      session,
      '/api/v1/users?state=disabled',
    );
    expect(onlyDisabled.items).toHaveLength(1);
    expect(onlyDisabled.items[0]?.username).toBe('off-user');

    const search = await apiGet<{ items: { username: string }[] }>(
      session,
      '/api/v1/users?search=active',
    );
    expect(search.items).toHaveLength(1);
  });

  it('تمدید، بازنشانی حجم و چرخش اعتبارنامه کار می‌کند', async () => {
    const created = await apiPost<{ user: { id: string; credentialUuid: string } }>(
      session,
      '/api/v1/users',
      { name: 'کاربر', username: 'ops-user', quota: '1GB' },
      201,
    );
    const id = created.user.id;

    await env.AFRA_DB.prepare('UPDATE users SET used_bytes = 900000 WHERE id = ?').bind(id).run();

    const extend = await apiPost<{ expiresAt: string }>(session, `/api/v1/users/${id}/extend`, {
      days: 15,
    });
    expect(Date.parse(extend.expiresAt)).toBeGreaterThan(Date.now());

    await apiPost(session, `/api/v1/users/${id}/reset-traffic`, {});
    const afterReset = await apiGet<{ user: { usedBytes: number } }>(session, `/api/v1/users/${id}`);
    expect(afterReset.user.usedBytes).toBe(0);

    const rotated = await apiPost<{ user: { credentialUuid: string } }>(
      session,
      `/api/v1/users/${id}/rotate-credentials`,
      {},
    );
    expect(rotated.user.credentialUuid).not.toBe(created.user.credentialUuid);
  });

  it('اشتراک با فرمت‌های مختلف تحویل داده می‌شود', async () => {
    await apiPost(session, '/api/v1/nodes', NODE_PAYLOAD, 201);
    const created = await apiPost<{ subscription: { token: string } }>(
      session,
      '/api/v1/users',
      { name: 'مشترک', username: 'sub-user', quota: '20GB' },
      201,
    );
    const token = created.subscription.token;

    const base64 = await SELF.fetch(`https://afra.test/sub/${token}?format=base64`);
    expect(base64.status).toBe(200);
    expect(base64.headers.get('cache-control')).toContain('no-store');
    const decoded = atob(await base64.text());
    expect(decoded).toContain('vless://');
    expect(decoded).toContain('edge.afra.test');

    const clash = await SELF.fetch(`https://afra.test/sub/${token}?format=clash`);
    const yaml = await clash.text();
    expect(clash.headers.get('content-type')).toContain('yaml');
    expect(yaml).toContain('proxies:');
    expect(clash.headers.get('subscription-userinfo')).toContain('total=');

    const auto = await SELF.fetch(`https://afra.test/sub/${token}`, {
      headers: { 'user-agent': 'ClashX/1.9' },
    });
    expect((await auto.text())).toContain('proxy-groups:');
  });

  it('اشتراک نامعتبر، منقضی یا با حجم تمام‌شده تحویل نمی‌شود', async () => {
    const missing = await SELF.fetch('https://afra.test/sub/this-token-does-not-exist-000000');
    expect(missing.status).toBe(404);

    const created = await apiPost<{ user: { id: string }; subscription: { token: string } }>(
      session,
      '/api/v1/users',
      { name: 'محدود', username: 'limited-user', quota: '1GB' },
      201,
    );

    await env.AFRA_DB.prepare('UPDATE users SET used_bytes = quota_bytes WHERE id = ?')
      .bind(created.user.id)
      .run();
    const exhausted = await SELF.fetch(`https://afra.test/sub/${created.subscription.token}`);
    expect(exhausted.status).toBe(403);
    expect(await exhausted.text()).toContain('حجم');

    await env.AFRA_DB.prepare(
      "UPDATE users SET used_bytes = 0, expires_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(created.user.id)
      .run();
    const expired = await SELF.fetch(`https://afra.test/sub/${created.subscription.token}`);
    expect(expired.status).toBe(403);
    expect(await expired.text()).toContain('منقضی');
  });

  it('چرخش توکن، لینک قبلی را از کار می‌اندازد', async () => {
    const created = await apiPost<{ user: { id: string }; subscription: { token: string } }>(
      session,
      '/api/v1/users',
      { name: 'چرخش', username: 'rotate-user' },
      201,
    );
    const oldToken = created.subscription.token;

    const rotated = await apiPost<{ subscription: { token: string } }>(
      session,
      `/api/v1/users/${created.user.id}/rotate-token`,
      {},
    );
    expect(rotated.subscription.token).not.toBe(oldToken);

    const oldResponse = await SELF.fetch(`https://afra.test/sub/${oldToken}`);
    expect(oldResponse.status).toBe(404);
    const newResponse = await SELF.fetch(`https://afra.test/sub/${rotated.subscription.token}`);
    expect(newResponse.status).toBe(200);
  });

  it('عملیات گروهی روی کاربران اجرا می‌شود', async () => {
    const a = await apiPost<{ user: { id: string } }>(
      session,
      '/api/v1/users',
      { name: 'گروهی الف', username: 'bulk-a' },
      201,
    );
    const b = await apiPost<{ user: { id: string } }>(
      session,
      '/api/v1/users',
      { name: 'گروهی ب', username: 'bulk-b' },
      201,
    );

    const result = await apiPost<{ affected: number }>(session, '/api/v1/users/bulk', {
      ids: [a.user.id, b.user.id],
      action: 'disable',
    });
    expect(result.affected).toBe(2);

    const disabled = await apiGet<{ total: number }>(session, '/api/v1/users?state=disabled');
    expect(disabled.total).toBe(2);
  });

  it('حذف کاربر، اشتراک او را نیز حذف می‌کند', async () => {
    const created = await apiPost<{ user: { id: string }; subscription: { token: string } }>(
      session,
      '/api/v1/users',
      { name: 'حذفی', username: 'delete-user' },
      201,
    );
    const deleted = await authedRequest(session, `/api/v1/users/${created.user.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);

    const subscription = await SELF.fetch(`https://afra.test/sub/${created.subscription.token}`);
    expect(subscription.status).toBe(404);
  });

  it('کانفیگ کلاینت برای Nodeهای کاربر تولید می‌شود', async () => {
    const node = await apiPost<{ node: { id: string } }>(session, '/api/v1/nodes', NODE_PAYLOAD, 201);
    const created = await apiPost<{ user: { id: string } }>(
      session,
      '/api/v1/users',
      { name: 'کانفیگ', username: 'config-user', nodeIds: [node.node.id] },
      201,
    );

    const configs = await apiGet<{ configs: { protocol: string; config: { uri: string } }[] }>(
      session,
      `/api/v1/users/${created.user.id}/configs`,
    );
    expect(configs.configs).toHaveLength(1);
    expect(configs.configs[0]?.protocol).toBe('vless');
    expect(configs.configs[0]?.config.uri).toContain('vless://');
  });
});
