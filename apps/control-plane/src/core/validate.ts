import { AfraError } from '@afra/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './context.js';

const MAX_BODY_BYTES = 512 * 1024;

/** خواندن و اعتبارسنجی بدنهٔ JSON با محدودیت حجم و پیام خطای فارسی. */
export async function parseJson<S extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: S,
): Promise<z.infer<S>> {
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) throw new AfraError('PAYLOAD_TOO_LARGE', 413);

  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES) throw new AfraError('PAYLOAD_TOO_LARGE', 413);

  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AfraError('VALIDATION_ERROR', 400, { reason: 'invalid_json' });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AfraError('VALIDATION_ERROR', 422, result.error.flatten());
  }
  return result.data;
}

/** اعتبارسنجی query string. */
export function parseQuery<S extends z.ZodTypeAny>(c: Context<AppEnv>, schema: S): z.infer<S> {
  const raw: Record<string, string> = {};
  const url = new URL(c.req.url);
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AfraError('VALIDATION_ERROR', 422, result.error.flatten());
  }
  return result.data;
}

export function requireParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new AfraError('VALIDATION_ERROR', 400, { param: name });
  return value;
}
