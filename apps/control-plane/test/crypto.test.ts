import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptBytes,
  decryptSecret,
  encryptBytes,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
  verifyTotp,
} from '../src/core/crypto.js';
import { generateRecoveryCode } from '../src/core/recovery.js';

const KEY = 'afra-test-secret-key-do-not-use-in-production-0123456789';

/** پیاده‌سازی مستقل TOTP در تست تا صحت verifyTotp واقعاً سنجیده شود. */
async function independentTotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter % 2 ** 32);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

describe('هش گذرواژه', () => {
  it('گذرواژه صحیح را تأیید و نادرست را رد می‌کند', async () => {
    const hash = await hashPassword('AfraTest-2026-Strong');
    expect(hash.startsWith('$afra$pbkdf2-sha512$210000$')).toBe(true);
    expect(await verifyPassword('AfraTest-2026-Strong', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('برای گذرواژهٔ یکسان هش متفاوت (نمک تصادفی) تولید می‌کند', async () => {
    const a = await hashPassword('same-password-123');
    const b = await hashPassword('same-password-123');
    expect(a).not.toBe(b);
  });

  it('قالب نامعتبر را رد می‌کند', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
  });
});

describe('رمزنگاری اسرار', () => {
  it('رفت و برگشت AES-GCM درست کار می‌کند', async () => {
    const payload = await encryptSecret('bot-token-123456', KEY);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain('bot-token');
    expect(await decryptSecret(payload, KEY)).toBe('bot-token-123456');
  });

  it('با کلید نادرست رمزگشایی نمی‌شود', async () => {
    const payload = await encryptSecret('secret', KEY);
    expect(await decryptSecret(payload, 'another-key-that-is-long-enough-000')).toBeNull();
  });

  it('پشتیبان رمزنگاری‌شده با عبارت عبور بازیابی می‌شود', async () => {
    const data = new TextEncoder().encode(JSON.stringify({ hello: 'دنیا' }));
    const encrypted = await encryptBytes(data, 'passphrase-for-backup');
    expect(new TextDecoder().decode(encrypted.subarray(0, 5))).toBe('AFRA1');
    const decrypted = await decryptBytes(encrypted, 'passphrase-for-backup');
    expect(decrypted).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(decrypted!))).toEqual({ hello: 'دنیا' });
    expect(await decryptBytes(encrypted, 'wrong-passphrase-here')).toBeNull();
  });
});

describe('TOTP', () => {
  it('base32 رفت و برگشت درست دارد', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('کد تولیدشده مستقل، توسط verifyTotp پذیرفته می‌شود', async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = await independentTotp(secret, Math.floor(now / 30_000));
    expect(await verifyTotp(secret, code, now)).toBe(true);
    // کد گام قبلی هم در پنجرهٔ ±۱ پذیرفته می‌شود
    const previous = await independentTotp(secret, Math.floor(now / 30_000) - 1);
    expect(await verifyTotp(secret, previous, now)).toBe(true);
    // کد چهار گام قبل باید رد شود
    const stale = await independentTotp(secret, Math.floor(now / 30_000) - 4);
    expect(await verifyTotp(secret, stale, now)).toBe(false);
  });

  it('کد بدفرمت را رد می‌کند', async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotp(secret, 'abcdef')).toBe(false);
    expect(await verifyTotp(secret, '12345')).toBe(false);
  });
});

describe('کمکی‌های امنیتی', () => {
  it('مقایسهٔ زمان‌ثابت درست کار می‌کند', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('SHA-256 قطعی است', async () => {
    expect(await sha256Hex('afra')).toBe(await sha256Hex('afra'));
    expect((await sha256Hex('afra')).length).toBe(64);
  });

  it('کد بازیابی قالب چهار بخشی دارد', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });
});
