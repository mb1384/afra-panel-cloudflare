/**
 * هدرهای امنیتی مشترک.
 *
 * نکتهٔ مهم: پاسخ‌هایی که از `env.ASSETS.fetch()` می‌آیند هدرهای غیرقابل‌تغییر
 * (immutable) دارند و `c.header()` روی آن‌ها بی‌اثر است. بنابراین پاسخ را
 * بازسازی می‌کنیم تا هدرها واقعاً اعمال شوند.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'cross-origin-opener-policy': 'same-origin',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * پاسخ را با هدرهای امنیتی بازمی‌سازد.
 * پاسخ‌های ارتقای WebSocket (101) دست‌نخورده برمی‌گردند چون بازسازی آن‌ها مجاز نیست.
 */
export function applySecurityHeaders(response: Response, requestId?: string): Response {
  if (response.status === 101) return response;

  const rebuilt = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    rebuilt.headers.set(key, value);
  }
  if (requestId) rebuilt.headers.set('x-request-id', requestId);

  const contentType = rebuilt.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    rebuilt.headers.set('content-security-policy', CSP);
  }

  return rebuilt;
}
