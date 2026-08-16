import { AfraError, faMessage } from '@afra/shared';
import type { ApiErr, ApiOk } from '@afra/shared';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function jsonOk<T>(data: T, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const payload: ApiOk<T> = { ok: true, data };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function jsonFail(
  code: string,
  status = 400,
  details?: unknown,
  message?: string,
): Response {
  const payload: ApiErr = {
    ok: false,
    error: { code, message: message ?? faMessage(code), ...(details ? { details } : {}) },
  };
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export function fromError(error: unknown): Response {
  if (error instanceof AfraError) {
    return jsonFail(error.code, error.status, error.details, error.message);
  }
  return jsonFail('INTERNAL_ERROR', 500);
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
