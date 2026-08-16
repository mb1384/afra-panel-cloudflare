import { bytesToBase64Url, bytesToHex } from '@afra/shared';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** شناسهٔ یکتا و مرتب‌شدنی بر اساس زمان (بدون وابستگی خارجی). */
export function newId(prefix?: string): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const random = crypto.getRandomValues(new Uint8Array(8));
  let suffix = '';
  for (const byte of random) suffix += ALPHABET[byte % ALPHABET.length];
  const id = `${time}${suffix}`;
  return prefix ? `${prefix}_${id}` : id;
}

/** توکن تصادفی امن (پیش‌فرض ۲۵۶ بیت) — برای نشست و اشتراک. */
export function newToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newUuid(): string {
  return crypto.randomUUID();
}

/** گذرواژهٔ تصادفی برای Trojan/Shadowsocks. */
export function newPassword(bytes = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoPlusMinutes(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoPlusDays(days: number, from: Date = new Date()): string {
  return isoPlusMinutes(days * 24 * 60, from);
}
