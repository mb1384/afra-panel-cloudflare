import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// مهاجرت‌های D1 خوانده می‌شوند تا در هر فایل تست روی دیتابیس محلی اعمال شوند.
const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          AFRA_SECRET_KEY: 'afra-test-secret-key-do-not-use-in-production-0123456789',
          AFRA_ENV: 'development',
          AFRA_VERSION: '1.0.0-test',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
