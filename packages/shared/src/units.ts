/** توابع خالص برای حجم ترافیک، سهمیه و انقضا. */

const UNITS_FA = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت', 'پتابایت'];
const UNITS_EN = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, locale: 'fa' | 'en' = 'fa'): string {
  if (bytes === null || bytes === undefined) return locale === 'fa' ? 'نامحدود' : 'Unlimited';
  const units = locale === 'fa' ? UNITS_FA : UNITS_EN;
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${units[0]}`;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const text = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${text.replace(/\.0+$/, '')} ${units[i]}`;
}

const SIZE_FACTORS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/** '10GB' یا '512 MB' را به بایت تبدیل می‌کند. برای «نامحدود» مقدار null برمی‌گردد. */
export function parseSize(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return input > 0 ? Math.floor(input) : null;
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === '0' || normalized === 'unlimited' || normalized === 'نامحدود') return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)([a-z]*)$/.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || 'b';
  const factor = SIZE_FACTORS[unit];
  if (!factor || !Number.isFinite(amount)) return null;
  return Math.floor(amount * factor);
}

export function remainingBytes(quotaBytes: number | null, usedBytes: number): number | null {
  if (quotaBytes === null) return null;
  return Math.max(quotaBytes - usedBytes, 0);
}

export function usagePercent(quotaBytes: number | null, usedBytes: number): number {
  if (quotaBytes === null || quotaBytes <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10);
}

export function isQuotaExhausted(quotaBytes: number | null, usedBytes: number): boolean {
  if (quotaBytes === null) return false;
  return usedBytes >= quotaBytes;
}

export function isExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

export function daysUntil(expiresAt: string | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return null;
  return Math.ceil((ts - now.getTime()) / 86_400_000);
}

export type UserState = 'active' | 'disabled' | 'expired' | 'exhausted';

export function userState(
  user: { enabled: boolean; expiresAt: string | null; quotaBytes: number | null; usedBytes: number },
  now: Date = new Date(),
): UserState {
  if (!user.enabled) return 'disabled';
  if (isExpired(user.expiresAt, now)) return 'expired';
  if (isQuotaExhausted(user.quotaBytes, user.usedBytes)) return 'exhausted';
  return 'active';
}

export const USER_STATE_LABELS_FA: Record<UserState, string> = {
  active: 'فعال',
  disabled: 'غیرفعال',
  expired: 'منقضی‌شده',
  exhausted: 'حجم تمام‌شده',
};

/** تبدیل ارقام لاتین به فارسی برای نمایش در UI. */
export function toPersianDigits(input: string | number): string {
  const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/[0-9]/g, (d) => persian[Number(d)]);
}
