import { applyD1Migrations, env } from 'cloudflare:test';

// اعمال مهاجرت‌ها روی دیتابیس محلی هر فایل تست (ذخیره‌سازی ایزوله است).
await applyD1Migrations(env.AFRA_DB, env.TEST_MIGRATIONS);
