import type { BalanceStrategy, LogLevel, SubscriptionFormat } from '@afra/shared';
import type { Bindings } from './env.js';
import { nowIso } from './ids.js';

export interface AfraSettings {
  panelName: string;
  language: 'fa' | 'en' | 'ru';
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  calendar: 'jalali' | 'gregorian';
  edgeUrl: string;
  sessionTtlMinutes: number;
  loginRateLimit: number;
  apiRateLimit: number;
  healthCheckIntervalMinutes: number;
  healthCheckTimeoutMs: number;
  degradedLatencyMs: number;
  balanceStrategy: BalanceStrategy;
  failoverEnabled: boolean;
  nodeNameTemplate: string;
  defaultSubscriptionFormat: SubscriptionFormat;
  subscriptionUpdateHours: number;
  revokeOnExpire: boolean;
  enableIpv6: boolean;
  quotaWarningPercent: number;
  expiryWarningDays: number;
  logLevel: LogLevel;
  logRetentionDays: number;
  trafficLoggingEnabled: boolean;
  maintenanceMode: boolean;
  setupCompleted: boolean;
  telegramEnabled: boolean;
  telegramNotifyEvents: string[];
}

export const DEFAULT_SETTINGS: AfraSettings = {
  panelName: 'پنل افرا',
  language: 'fa',
  timezone: 'Asia/Tehran',
  theme: 'system',
  calendar: 'jalali',
  edgeUrl: '',
  sessionTtlMinutes: 720,
  loginRateLimit: 5,
  apiRateLimit: 600,
  healthCheckIntervalMinutes: 5,
  healthCheckTimeoutMs: 5000,
  degradedLatencyMs: 900,
  balanceStrategy: 'latency',
  failoverEnabled: true,
  nodeNameTemplate: '{FLAG} {COUNTRY} {CITY} {NAME}',
  defaultSubscriptionFormat: 'auto',
  subscriptionUpdateHours: 12,
  revokeOnExpire: false,
  enableIpv6: false,
  quotaWarningPercent: 85,
  expiryWarningDays: 3,
  logLevel: 'INFO',
  logRetentionDays: 14,
  trafficLoggingEnabled: true,
  maintenanceMode: false,
  setupCompleted: false,
  telegramEnabled: false,
  telegramNotifyEvents: ['node.down', 'node.recovered', 'user.expired', 'quota.warning'],
};

const KV_CACHE_KEY = 'settings:all';
const KV_CACHE_TTL_SECONDS = 60;

/** کلیدهایی که مقدارشان رمزنگاری‌شده است و هرگز خام برگردانده نمی‌شوند. */
export const SECRET_SETTING_KEYS = new Set([
  'telegramBotToken',
  'telegramWebhookSecret',
  'cloudflareApiToken',
]);

export class SettingsService {
  private cache: AfraSettings | null = null;
  private raw: Record<string, unknown> | null = null;

  constructor(private readonly env: Bindings) {}

  async load(): Promise<AfraSettings> {
    if (this.cache) return this.cache;

    const cached = await this.env.AFRA_KV.get(KV_CACHE_KEY, 'json').catch(() => null);
    if (cached && typeof cached === 'object') {
      this.raw = cached as Record<string, unknown>;
      this.cache = { ...DEFAULT_SETTINGS, ...(cached as Partial<AfraSettings>) };
      return this.cache;
    }

    const rows = await this.env.AFRA_DB.prepare(
      'SELECT key, value, is_secret FROM system_settings',
    ).all<{ key: string; value: string; is_secret: number }>();

    const parsed: Record<string, unknown> = {};
    for (const row of rows.results ?? []) {
      if (row.is_secret === 1) continue;
      try {
        parsed[row.key] = JSON.parse(row.value) as unknown;
      } catch {
        parsed[row.key] = row.value;
      }
    }

    this.raw = parsed;
    this.cache = { ...DEFAULT_SETTINGS, ...(parsed as Partial<AfraSettings>) };
    await this.env.AFRA_KV.put(KV_CACHE_KEY, JSON.stringify(parsed), {
      expirationTtl: KV_CACHE_TTL_SECONDS,
    }).catch(() => undefined);
    return this.cache;
  }

  async get<K extends keyof AfraSettings>(key: K): Promise<AfraSettings[K]> {
    const settings = await this.load();
    return settings[key];
  }

  async publicSettings(): Promise<Record<string, unknown>> {
    const settings = await this.load();
    return { ...settings };
  }

  /** خواندن مقدار خام (شامل کلیدهای غیر تایپ‌شده). */
  async getRaw<T = unknown>(key: string, fallback: T): Promise<T> {
    await this.load();
    const value = this.raw?.[key];
    return (value === undefined ? fallback : value) as T;
  }

  async set(key: string, value: unknown, isSecret = false): Promise<void> {
    await this.env.AFRA_DB.prepare(
      `INSERT INTO system_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`,
    )
      .bind(key, JSON.stringify(value ?? null), isSecret ? 1 : 0, nowIso())
      .run();
    await this.invalidate();
  }

  async setMany(values: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const statements = entries.map(([key, value]) =>
      this.env.AFRA_DB.prepare(
        `INSERT INTO system_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, JSON.stringify(value), SECRET_SETTING_KEYS.has(key) ? 1 : 0, nowIso()),
    );
    await this.env.AFRA_DB.batch(statements);
    await this.invalidate();
  }

  /** خواندن یک مقدار محرمانه (رمزگشایی در فراخوان انجام می‌شود). */
  async getSecretRaw(key: string): Promise<string | null> {
    const row = await this.env.AFRA_DB.prepare(
      'SELECT value FROM system_settings WHERE key = ? AND is_secret = 1',
    )
      .bind(key)
      .first<{ value: string }>();
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  async invalidate(): Promise<void> {
    this.cache = null;
    this.raw = null;
    await this.env.AFRA_KV.delete(KV_CACHE_KEY).catch(() => undefined);
  }
}
