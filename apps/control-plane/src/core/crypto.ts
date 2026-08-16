import { base64ToBytes, bytesToBase64, bytesToHex } from '@afra/shared';

/*
 * توجه معماری:
 * محیط اجرای Cloudflare Workers کتابخانهٔ بومی Argon2id ندارد و افزودن WASM
 * برای هر درخواست هزینهٔ CPU و حجم باندل ایجاد می‌کند. بنابراین از
 * PBKDF2-HMAC-SHA512 با ۲۱۰٬۰۰۰ تکرار استفاده می‌کنیم که مقدار پیشنهادی
 * OWASP (۲۰۲۳) برای این الگوریتم است و روی WebCrypto بومی اجرا می‌شود.
 * قالب ذخیره‌سازی نسخه‌دار است تا مهاجرت به الگوریتم دیگر ممکن بماند.
 */
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_HASH = 'SHA-512';
const PBKDF2_KEY_LEN = 32;
const HASH_PREFIX = '$afra$pbkdf2-sha512$';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(HASH_PREFIX)) return false;
  const parts = stored.slice(HASH_PREFIX.length).split('$');
  if (parts.length !== 3) return false;
  const iterations = Number(parts[0]);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  const salt = base64ToBytes(parts[1]);
  const expected = base64ToBytes(parts[2]);
  const derived = await pbkdf2(password, salt, iterations);
  return timingSafeEqualBytes(derived, expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/* -------------------------- رمزنگاری اسرار (at rest) -------------------------- */

const ENC_VERSION = 'v1';

async function aesKey(secretKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** رمزنگاری AES-256-GCM؛ خروجی: v1.<iv>.<ciphertext> */
export async function encryptSecret(plaintext: string, secretKey: string): Promise<string> {
  const key = await aesKey(secretKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plaintext),
  );
  return `${ENC_VERSION}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string, secretKey: string): Promise<string | null> {
  const parts = payload.split('.');
  if (parts.length !== 3 || parts[0] !== ENC_VERSION) return null;
  try {
    const key = await aesKey(secretKey);
    const iv = base64ToBytes(parts[1]);
    const cipher = base64ToBytes(parts[2]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipher as unknown as BufferSource,
    );
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

/** رمزنگاری آرایهٔ بایت (برای پشتیبان‌ها) با عبارت عبور دلخواه. */
export async function encryptBytes(
  data: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKeyFromPassphrase(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      data as unknown as BufferSource,
    ),
  );
  // قالب: AFRA1 | salt(16) | iv(12) | ciphertext
  const magic = encoder.encode('AFRA1');
  const out = new Uint8Array(magic.length + salt.length + iv.length + cipher.length);
  out.set(magic, 0);
  out.set(salt, magic.length);
  out.set(iv, magic.length + salt.length);
  out.set(cipher, magic.length + salt.length + iv.length);
  return out;
}

export async function decryptBytes(
  payload: Uint8Array,
  passphrase: string,
): Promise<Uint8Array | null> {
  const magic = decoder.decode(payload.subarray(0, 5));
  if (magic !== 'AFRA1') return null;
  const salt = payload.subarray(5, 21);
  const iv = payload.subarray(21, 33);
  const cipher = payload.subarray(33);
  try {
    const key = await deriveAesKeyFromPassphrase(passphrase, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipher as unknown as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

async function deriveAesKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* -------------------------------- TOTP (2FA) -------------------------------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base32Encode(bytes);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function totpCode(secret: string, counter: number): Promise<string> {
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

/** اعتبارسنجی کد TOTP با پنجرهٔ ±۱ گام (۳۰ ثانیه). */
export async function verifyTotp(
  secret: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  for (const drift of [-1, 0, 1]) {
    const expected = await totpCode(secret, counter + drift);
    if (timingSafeEqual(expected, code)) return true;
  }
  return false;
}

export function buildTotpUri(secret: string, account: string, issuer = 'Afra Panel'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
