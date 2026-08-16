const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface FieldErrors {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}

/** توکن CSRF از کوکی قابل خواندن (double-submit) گرفته می‌شود. */
export function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)afra_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-afra-csrf'] = readCsrfToken();

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'پاسخ سرور قابل پردازش نبود.', response.status);
  }

  const envelope = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; details?: unknown } };

  if (!response.ok || !envelope || envelope.ok === false) {
    const error = envelope && envelope.ok === false ? envelope.error : null;
    throw new ApiError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'خطای نامشخص در ارتباط با سرور.',
      response.status,
      error?.details,
    );
  }

  return envelope.data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** استخراج خطاهای فیلدی برای نمایش زیر هر ورودی فرم. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details) return {};
  const details = error.details as Partial<FieldErrors>;
  if (!details.fieldErrors) return {};
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(details.fieldErrors)) {
    if (messages && messages.length > 0) out[key] = messages[0];
  }
  return out;
}
