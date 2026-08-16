/**
 * RateLimiterDO — شمارندهٔ پنجرهٔ لغزان برای محدودسازی نرخ درخواست.
 * هر کلید (مثلاً login:IP) یک نمونهٔ مستقل دارد.
 */
interface ConsumeBody {
  limit: number;
  windowSeconds: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export class RateLimiterDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/reset') {
      await this.state.storage.deleteAll();
      return Response.json({ ok: true });
    }

    if (url.pathname !== '/consume') {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as ConsumeBody | null;
    const limit = Math.max(1, Math.floor(body?.limit ?? 60));
    const windowSeconds = Math.max(1, Math.floor(body?.windowSeconds ?? 60));
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    const stored = (await this.state.storage.get<WindowState>('window')) ?? {
      windowStart: now,
      count: 0,
    };

    let windowStart = stored.windowStart;
    let count = stored.count;

    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }

    if (count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      return Response.json({ allowed: false, remaining: 0, retryAfter });
    }

    count += 1;
    await this.state.storage.put('window', { windowStart, count });
    // پاک‌سازی خودکار حالت بعد از پایان پنجره
    await this.state.storage.setAlarm(windowStart + windowMs + 1000);

    return Response.json({
      allowed: true,
      remaining: limit - count,
      retryAfter: 0,
    });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
