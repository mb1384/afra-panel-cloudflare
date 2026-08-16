import type { LogLevel } from '@afra/shared';
import type { Bindings } from './env.js';
import { newId, nowIso } from './ids.js';

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

/** کلیدهایی که هرگز نباید در لاگ ظاهر شوند. */
const REDACT_KEYS = [
  'password',
  'newpassword',
  'currentpassword',
  'passphrase',
  'token',
  'apitoken',
  'bottoken',
  'secret',
  'secretkey',
  'webhooksecret',
  'authorization',
  'cookie',
  'credentialuuid',
  'trojanpassword',
  'sspassword',
  'totp',
  'totpsecret',
  'recoverycode',
  'subscriptiontoken',
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.includes(key.toLowerCase())) {
        out[key] = '[redacted]';
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** پوشاندن توکن اشتراک در متن‌های آزاد (مثلاً URL). */
export function maskToken(text: string): string {
  return text.replace(/([A-Za-z0-9_-]{12})[A-Za-z0-9_-]{8,}/g, '$1…');
}

export class Logger {
  private readonly minLevel: number;

  constructor(
    private readonly env: Bindings,
    level: LogLevel = 'INFO',
    private readonly requestId: string = newId('req'),
  ) {
    this.minLevel = LEVEL_ORDER[level] ?? 20;
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const safeContext = context ? (redact(context) as Record<string, unknown>) : undefined;
    const line = {
      level,
      time: nowIso(),
      requestId: this.requestId,
      env: this.env.AFRA_ENV,
      message,
      ...(safeContext ? { context: safeContext } : {}),
    };
    const serialized = JSON.stringify(line);
    if (level === 'ERROR') console.error(serialized);
    else if (level === 'WARN') console.warn(serialized);
    else console.log(serialized);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('ERROR', message, context);
  }

  /** ثبت لاگ پایدار در D1 برای نمایش در پنل. */
  async persist(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    this.write(level, message, context);
    if (LEVEL_ORDER[level] < LEVEL_ORDER.WARN) return;
    try {
      await this.env.AFRA_DB.prepare(
        'INSERT INTO app_logs (id, level, message, context, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          newId('log'),
          level,
          message.slice(0, 500),
          context ? JSON.stringify(redact(context)).slice(0, 4000) : null,
          nowIso(),
        )
        .run();
    } catch (error) {
      console.error('failed to persist log', String(error));
    }
  }
}
