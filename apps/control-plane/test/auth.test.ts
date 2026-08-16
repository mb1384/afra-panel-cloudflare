import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SETUP_PAYLOAD,
  apiGet,
  apiPost,
  authedRequest,
  bootstrapAdmin,
  json,
  login,
  resetDatabase,
} from './helpers.js';

describe('راه‌اندازی اولیه و احراز هویت', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('وضعیت راه‌اندازی ابتدا ناتمام است', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/setup/status');
    const body = await json<{ data: { completed: boolean; hasAdmin: boolean } }>(response);
    expect(response.status).toBe(200);
    expect(body.data.completed).toBe(false);
    expect(body.data.hasAdmin).toBe(false);
  });

  it('راه‌اندازی مدیر ارشد را می‌سازد و کد بازیابی می‌دهد', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SETUP_PAYLOAD),
    });
    const body = await json<{ data: { recoveryCode: string; admin: { role: string } } }>(response);
    expect(response.status).toBe(200);
    expect(body.data.admin.role).toBe('super_admin');
    expect(body.data.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

    // تلاش دوم باید رد شود
    const second = await SELF.fetch('https://afra.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SETUP_PAYLOAD),
    });
    expect(second.status).toBe(409);
  });

  it('گذرواژهٔ ضعیف در راه‌اندازی رد می‌شود', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SETUP_PAYLOAD, password: 'weak' }),
    });
    expect(response.status).toBe(422);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ورود با اطلاعات درست و نادرست', async () => {
    await bootstrapAdmin();

    const bad = await login(SETUP_PAYLOAD.username, 'totally-wrong-password');
    expect(bad.response.status).toBe(401);
    const badBody = await json<{ error: { code: string; message: string } }>(bad.response);
    expect(badBody.error.code).toBe('INVALID_CREDENTIALS');
    expect(badBody.error.message).toContain('نادرست');

    const good = await login(SETUP_PAYLOAD.username, SETUP_PAYLOAD.password);
    expect(good.response.status).toBe(200);
    expect(good.session).not.toBeNull();

    const me = await apiGet<{ admin: { username: string }; permissions: string[] }>(
      good.session!,
      '/api/v1/auth/me',
    );
    expect(me.admin.username).toBe(SETUP_PAYLOAD.username);
    expect(me.permissions).toContain('users.write');
  });

  it('دسترسی بدون نشست رد می‌شود', async () => {
    await bootstrapAdmin();
    const response = await SELF.fetch('https://afra.test/api/v1/users');
    expect(response.status).toBe(401);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('درخواست تغییردهنده بدون توکن CSRF رد می‌شود', async () => {
    const session = await bootstrapAdmin();
    const response = await SELF.fetch('https://afra.test/api/v1/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ name: 'x', username: 'csrfless' }),
    });
    expect(response.status).toBe(403);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('CSRF_INVALID');
  });

  it('محافظت brute-force بعد از چند تلاش ناموفق فعال می‌شود', async () => {
    await bootstrapAdmin();
    let blocked = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await login(SETUP_PAYLOAD.username, `wrong-password-${attempt}`);
      if (result.response.status === 429) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('گذرواژه تغییر می‌کند و نشست‌های دیگر باطل می‌شوند', async () => {
    const first = await bootstrapAdmin();
    const second = await login(SETUP_PAYLOAD.username, SETUP_PAYLOAD.password);
    expect(second.session).not.toBeNull();

    await apiPost(second.session!, '/api/v1/auth/password', {
      currentPassword: SETUP_PAYLOAD.password,
      newPassword: 'AfraNew-Password-2026',
    });

    // نشست قدیمی باطل شده است
    const stale = await authedRequest(first, '/api/v1/auth/me');
    expect(stale.status).toBe(401);

    // ورود با گذرواژهٔ جدید
    const relogin = await login(SETUP_PAYLOAD.username, 'AfraNew-Password-2026');
    expect(relogin.response.status).toBe(200);
  });

  it('خروج، نشست را باطل می‌کند', async () => {
    const session = await bootstrapAdmin();
    const logout = await authedRequest(session, '/api/v1/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);
    const after = await authedRequest(session, '/api/v1/auth/me');
    expect(after.status).toBe(401);
  });

  it('فعال‌سازی دومرحله‌ای، ورود را نیازمند کد می‌کند', async () => {
    const session = await bootstrapAdmin();
    const setup = await apiPost<{ secret: string; uri: string }>(
      session,
      '/api/v1/auth/totp/setup',
      {},
    );
    expect(setup.uri).toContain('otpauth://totp/');

    // کد نادرست پذیرفته نمی‌شود
    const badEnable = await authedRequest(session, '/api/v1/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code: '000000' }),
    });
    expect([400, 422]).toContain(badEnable.status);

    // فعال‌سازی مستقیم در دیتابیس برای بررسی مسیر ورود
    await env.AFRA_DB.prepare('UPDATE admins SET totp_enabled = 1 WHERE username = ?')
      .bind(SETUP_PAYLOAD.username)
      .run();

    const attempt = await login(SETUP_PAYLOAD.username, SETUP_PAYLOAD.password);
    expect(attempt.response.status).toBe(401);
    const body = await json<{ error: { code: string } }>(attempt.response);
    expect(body.error.code).toBe('TOTP_REQUIRED');
  });

  it('بازیابی با کد بازیابی گذرواژه را تغییر می‌دهد', async () => {
    const response = await SELF.fetch('https://afra.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SETUP_PAYLOAD),
    });
    const body = await json<{ data: { recoveryCode: string } }>(response);

    const recover = await SELF.fetch('https://afra.test/api/v1/auth/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: SETUP_PAYLOAD.username,
        recoveryCode: body.data.recoveryCode,
        newPassword: 'AfraRecovered-2026x',
      }),
    });
    expect(recover.status).toBe(200);
    const recovered = await json<{ data: { recoveryCode: string } }>(recover);
    expect(recovered.data.recoveryCode).not.toBe(body.data.recoveryCode);

    const relogin = await login(SETUP_PAYLOAD.username, 'AfraRecovered-2026x');
    expect(relogin.response.status).toBe(200);
  });

  it('رویدادهای ورود در گزارش رویدادها ثبت می‌شود', async () => {
    const session = await bootstrapAdmin();
    const audit = await apiGet<{ items: { action: string }[] }>(session, '/api/v1/audit');
    expect(audit.items.some((item) => item.action === 'setup.completed')).toBe(true);
  });
});
