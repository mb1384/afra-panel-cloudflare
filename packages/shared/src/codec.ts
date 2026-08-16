/** توابع کدگذاری مستقل از محیط (Workers، مرورگر، Node). */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    output += B64_CHARS[b0 >> 2];
    output += B64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    output += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    output += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return output;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  const lookup = new Map<string, number>();
  for (let i = 0; i < B64_CHARS.length; i += 1) lookup.set(B64_CHARS[i], i);
  const chars = clean.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((chars.length * 3) / 4));
  let bitBuffer = 0;
  let bitCount = 0;
  let index = 0;
  for (const ch of chars) {
    const value = lookup.get(ch);
    if (value === undefined) continue;
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[index] = (bitBuffer >> bitCount) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function base64ToUtf8(input: string): string {
  return new TextDecoder().decode(base64ToBytes(input));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
