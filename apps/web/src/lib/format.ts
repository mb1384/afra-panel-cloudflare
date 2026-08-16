import { toJalaali } from 'jalaali-js';
import { formatBytes, toPersianDigits } from '@afra/shared';

export { formatBytes, toPersianDigits };

const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export type CalendarMode = 'jalali' | 'gregorian';

/** تاریخ شمسی یا میلادی بر اساس تنظیم پنل. */
export function formatDate(
  iso: string | null | undefined,
  calendar: CalendarMode = 'jalali',
  withTime = false,
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const time = withTime
    ? ` ${toPersianDigits(String(date.getHours()).padStart(2, '0'))}:${toPersianDigits(
        String(date.getMinutes()).padStart(2, '0'),
      )}`
    : '';

  if (calendar === 'gregorian') {
    return `${toPersianDigits(date.toISOString().slice(0, 10))}${time}`;
  }

  const { jy, jm, jd } = toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}${time}`;
}

/** فاصلهٔ زمانی نسبی فارسی (مثلاً «۳ روز پیش»). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '—';
  const diff = Date.now() - timestamp;
  const future = diff < 0;
  const seconds = Math.abs(diff) / 1000;

  const units: [number, string][] = [
    [60, 'ثانیه'],
    [3600, 'دقیقه'],
    [86_400, 'ساعت'],
    [2_592_000, 'روز'],
    [31_536_000, 'ماه'],
  ];

  if (seconds < 60) return future ? 'چند لحظه بعد' : 'همین حالا';
  if (seconds < 3600) return `${toPersianDigits(Math.floor(seconds / 60))} دقیقه ${future ? 'بعد' : 'پیش'}`;
  if (seconds < 86_400) return `${toPersianDigits(Math.floor(seconds / 3600))} ساعت ${future ? 'بعد' : 'پیش'}`;
  if (seconds < 2_592_000) return `${toPersianDigits(Math.floor(seconds / 86_400))} روز ${future ? 'بعد' : 'پیش'}`;
  void units;
  return `${toPersianDigits(Math.floor(seconds / 2_592_000))} ماه ${future ? 'بعد' : 'پیش'}`;
}

export function daysLabel(iso: string | null | undefined): string {
  if (!iso) return 'نامحدود';
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return '—';
  if (days < 0) return 'منقضی شده';
  if (days === 0) return 'امروز';
  return `${toPersianDigits(days)} روز`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
