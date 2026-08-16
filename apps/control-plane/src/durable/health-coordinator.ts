import type { HealthState } from '@afra/shared';

/**
 * HealthCoordinatorDO — هماهنگ‌کنندهٔ بررسی سلامت.
 * وظیفه: جلوگیری از اجرای هم‌زمان چند چرخهٔ بررسی (single-flight)،
 * نگه‌داشتن خلاصهٔ آخرین اجرا و اجرای واقعی بررسی TCP/TLS.
 */
export interface HealthTarget {
  id: string;
  hostname: string;
  port: number;
  useTls: boolean;
}

export interface HealthOutcome {
  id: string;
  ok: boolean;
  latencyMs: number | null;
  state: HealthState;
  error: string | null;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  checked: number;
  healthy: number;
  degraded: number;
  unreachable: number;
  outcomes: HealthOutcome[];
}

export function classifyHealth(
  ok: boolean,
  latencyMs: number | null,
  degradedThresholdMs: number,
): HealthState {
  if (!ok) return 'unreachable';
  if (latencyMs !== null && latencyMs > degradedThresholdMs) return 'degraded';
  return 'healthy';
}

/** بررسی واقعی دسترسی‌پذیری با باز کردن اتصال TCP/TLS به endpoint پیکربندی‌شده. */
export async function probeTarget(
  target: HealthTarget,
  timeoutMs: number,
  degradedThresholdMs: number,
): Promise<HealthOutcome> {
  const started = Date.now();
  try {
    const { connect } = await import('cloudflare:sockets');
    const socket = connect(
      { hostname: target.hostname, port: target.port },
      { secureTransport: target.useTls ? 'on' : 'off', allowHalfOpen: false },
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    try {
      await Promise.race([socket.opened, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const latencyMs = Date.now() - started;
    try {
      await socket.close();
    } catch {
      // بستن اتصال اهمیتی برای نتیجه ندارد
    }
    return {
      id: target.id,
      ok: true,
      latencyMs,
      state: classifyHealth(true, latencyMs, degradedThresholdMs),
      error: null,
    };
  } catch (error) {
    return {
      id: target.id,
      ok: false,
      latencyMs: null,
      state: 'unreachable',
      error: String(error instanceof Error ? error.message : error).slice(0, 200),
    };
  }
}

interface RunRequest {
  targets: HealthTarget[];
  timeoutMs: number;
  degradedThresholdMs: number;
  concurrency?: number;
}

export class HealthCoordinatorDO implements DurableObject {
  private running = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/last') {
      const last = await this.state.storage.get<RunSummary>('lastRun');
      return Response.json({ running: this.running, last: last ?? null });
    }

    if (url.pathname !== '/run') {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    if (this.running) {
      return Response.json({ skipped: true, reason: 'in_progress' }, { status: 409 });
    }

    const body = (await request.json().catch(() => null)) as RunRequest | null;
    if (!body || !Array.isArray(body.targets)) {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    try {
      const outcomes = await this.runBatch(
        body.targets,
        body.timeoutMs ?? 5000,
        body.degradedThresholdMs ?? 900,
        Math.min(Math.max(body.concurrency ?? 6, 1), 12),
      );
      const summary: RunSummary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        checked: outcomes.length,
        healthy: outcomes.filter((o) => o.state === 'healthy').length,
        degraded: outcomes.filter((o) => o.state === 'degraded').length,
        unreachable: outcomes.filter((o) => o.state === 'unreachable').length,
        outcomes,
      };
      await this.state.storage.put('lastRun', summary);
      return Response.json(summary);
    } finally {
      this.running = false;
    }
  }

  private async runBatch(
    targets: HealthTarget[],
    timeoutMs: number,
    degradedThresholdMs: number,
    concurrency: number,
  ): Promise<HealthOutcome[]> {
    const results: HealthOutcome[] = [];
    const queue = [...targets];

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const target = queue.shift();
        if (!target) return;
        results.push(await probeTarget(target, timeoutMs, degradedThresholdMs));
      }
    });

    await Promise.all(workers);
    return results;
  }
}
