/** کدهای خطای یکدست + پیام فارسی متناظر. */
export const ERROR_MESSAGES_FA: Record<string, string> = {
  VALIDATION_ERROR: 'داده‌های ارسالی نامعتبر است.',
  UNAUTHENTICATED: 'برای انجام این عملیات باید وارد شوید.',
  INVALID_CREDENTIALS: 'نام کاربری یا گذرواژه نادرست است.',
  TOTP_REQUIRED: 'کد تأیید دومرحله‌ای لازم است.',
  TOTP_INVALID: 'کد تأیید دومرحله‌ای نادرست است.',
  FORBIDDEN: 'شما مجوز لازم برای این عملیات را ندارید.',
  RATE_LIMITED: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  CSRF_INVALID: 'اعتبارسنجی درخواست ناموفق بود. صفحه را بازخوانی کنید.',
  NOT_FOUND: 'موردی یافت نشد.',
  USER_NOT_FOUND: 'کاربر یافت نشد.',
  NODE_NOT_FOUND: 'سرور (Node) یافت نشد.',
  SUBSCRIPTION_NOT_FOUND: 'اشتراک یافت نشد.',
  SUBSCRIPTION_REVOKED: 'این اشتراک لغو شده است.',
  SUBSCRIPTION_EXPIRED: 'اشتراک منقضی شده است.',
  QUOTA_EXCEEDED: 'حجم مجاز به پایان رسیده است.',
  DUPLICATE: 'این مقدار قبلاً ثبت شده است.',
  USERNAME_TAKEN: 'این نام کاربری قبلاً استفاده شده است.',
  SETUP_ALREADY_DONE: 'راه‌اندازی اولیه قبلاً انجام شده است.',
  SETUP_REQUIRED: 'ابتدا راه‌اندازی اولیه را کامل کنید.',
  CLOUDFLARE_NOT_CONFIGURED: 'اتصال Cloudflare پیکربندی نشده است.',
  CLOUDFLARE_API_ERROR: 'خطا در ارتباط با Cloudflare.',
  TELEGRAM_NOT_CONFIGURED: 'ربات تلگرام پیکربندی نشده است.',
  BACKUP_NOT_CONFIGURED: 'فضای ذخیره‌سازی پشتیبان (R2) پیکربندی نشده است.',
  BACKUP_NOT_FOUND: 'فایل پشتیبان یافت نشد.',
  RESTORE_FAILED: 'بازگردانی پشتیبان ناموفق بود.',
  CHAIN_INVALID: 'زنجیرهٔ پروکسی نامعتبر است.',
  INTERNAL_ERROR: 'خطای داخلی سرور. رویداد در لاگ ثبت شد.',
  PAYLOAD_TOO_LARGE: 'حجم درخواست بیش از حد مجاز است.',
  NOT_IMPLEMENTED: 'این قابلیت در این نسخه فعال نیست.',
};

export function faMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES_FA[code] ?? fallback ?? ERROR_MESSAGES_FA.INTERNAL_ERROR;
}

export class AfraError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
    message?: string,
  ) {
    super(message ?? faMessage(code));
    this.name = 'AfraError';
  }
}
