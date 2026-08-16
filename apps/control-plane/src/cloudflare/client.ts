import { AfraError } from '@afra/shared';

/**
 * لایهٔ یکپارچه‌سازی Cloudflare API.
 * توکن فقط سمت سرور نگه داشته می‌شود و هرگز به فرانت‌اند یا لاگ نمی‌رود.
 * تنها endpointهایی پیاده‌سازی شده‌اند که افرا واقعاً به آن‌ها نیاز دارد.
 */
const API_BASE = 'https://api.cloudflare.com/client/v4';

export interface CfListResult<T> {
  result: T[];
  result_info?: { page: number; per_page: number; total_count: number };
}

export interface CfZone {
  id: string;
  name: string;
  status: string;
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface CfWorkerScript {
  id: string;
  created_on?: string;
  modified_on?: string;
}

export interface CfKvNamespace {
  id: string;
  title: string;
}

export interface CfD1Database {
  uuid: string;
  name: string;
}

export interface CfR2Bucket {
  name: string;
  creation_date?: string;
}

export interface CfWorkerRoute {
  id: string;
  pattern: string;
  script: string;
}

export interface CfTokenStatus {
  id: string;
  status: string;
}

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
  messages?: unknown[];
  result_info?: { page: number; per_page: number; total_count: number };
}

export interface WorkerBinding {
  type: 'kv_namespace' | 'plain_text' | 'secret_text' | 'd1';
  name: string;
  namespace_id?: string;
  text?: string;
  id?: string;
}

export class CloudflareClient {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
  ) {
    if (!accountId || !apiToken) throw new AfraError('CLOUDFLARE_NOT_CONFIGURED', 400);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = 20_000,
  ): Promise<CfEnvelope<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers ?? {});
      headers.set('Authorization', `Bearer ${this.apiToken}`);
      if (!(init.body instanceof FormData) && init.body) {
        headers.set('content-type', 'application/json');
      }
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: CfEnvelope<T>;
      try {
        payload = JSON.parse(text) as CfEnvelope<T>;
      } catch {
        throw new AfraError('CLOUDFLARE_API_ERROR', 502, {
          status: response.status,
          body: text.slice(0, 300),
        });
      }
      if (!response.ok || payload.success === false) {
        const message = payload.errors?.map((e) => e.message).join(' | ') ?? 'unknown';
        throw new AfraError('CLOUDFLARE_API_ERROR', 502, {
          status: response.status,
          cfErrors: payload.errors ?? null,
        }, `خطای Cloudflare: ${message}`);
      }
      return payload;
    } catch (error) {
      if (error instanceof AfraError) throw error;
      throw new AfraError('CLOUDFLARE_API_ERROR', 502, { reason: String(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------ account / token ------------------------------ */

  async verifyToken(): Promise<CfTokenStatus> {
    const res = await this.request<CfTokenStatus>('/user/tokens/verify');
    return res.result;
  }

  async listZones(): Promise<CfZone[]> {
    const res = await this.request<CfZone[]>('/zones?per_page=50');
    return res.result ?? [];
  }

  /* ------------------------------------ DNS ----------------------------------- */

  async listDnsRecords(zoneId: string): Promise<CfDnsRecord[]> {
    const res = await this.request<CfDnsRecord[]>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100`,
    );
    return res.result ?? [];
  }

  async createDnsRecord(
    zoneId: string,
    record: { type: string; name: string; content: string; proxied: boolean; ttl: number },
  ): Promise<CfDnsRecord> {
    const res = await this.request<CfDnsRecord>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records`,
      { method: 'POST', body: JSON.stringify(record) },
    );
    return res.result;
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { method: 'DELETE' },
    );
  }

  /* ---------------------------------- Workers --------------------------------- */

  async listWorkerScripts(): Promise<CfWorkerScript[]> {
    const res = await this.request<CfWorkerScript[]>(
      `/accounts/${this.accountId}/workers/scripts`,
    );
    return res.result ?? [];
  }

  async getWorkersSubdomain(): Promise<string | null> {
    try {
      const res = await this.request<{ subdomain: string }>(
        `/accounts/${this.accountId}/workers/subdomain`,
      );
      return res.result?.subdomain ?? null;
    } catch {
      return null;
    }
  }

  /** آپلود/به‌روزرسانی یک Worker به‌صورت ES Module. */
  async uploadWorkerScript(options: {
    scriptName: string;
    script: string;
    bindings: WorkerBinding[];
    compatibilityDate?: string;
    compatibilityFlags?: string[];
  }): Promise<{ id: string }> {
    const metadata = {
      main_module: 'worker.js',
      compatibility_date: options.compatibilityDate ?? '2025-01-15',
      compatibility_flags: options.compatibilityFlags ?? ['nodejs_compat'],
      bindings: options.bindings,
    };

    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
      'metadata.json',
    );
    form.append(
      'worker.js',
      new Blob([options.script], { type: 'application/javascript+module' }),
      'worker.js',
    );

    const res = await this.request<{ id: string }>(
      `/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(options.scriptName)}`,
      { method: 'PUT', body: form },
      45_000,
    );
    return res.result ?? { id: options.scriptName };
  }

  async deleteWorkerScript(scriptName: string): Promise<void> {
    await this.request(
      `/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(scriptName)}?force=true`,
      { method: 'DELETE' },
    );
  }

  /** فعال‌سازی دامنهٔ workers.dev برای دسترسی سریع به endpoint. */
  async enableWorkersDevSubdomain(scriptName: string): Promise<void> {
    await this.request(
      `/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
      { method: 'POST', body: JSON.stringify({ enabled: true, previews_enabled: false }) },
    );
  }

  async listWorkerRoutes(zoneId: string): Promise<CfWorkerRoute[]> {
    const res = await this.request<CfWorkerRoute[]>(
      `/zones/${encodeURIComponent(zoneId)}/workers/routes`,
    );
    return res.result ?? [];
  }

  async createWorkerRoute(
    zoneId: string,
    pattern: string,
    scriptName: string,
  ): Promise<CfWorkerRoute> {
    const res = await this.request<CfWorkerRoute>(
      `/zones/${encodeURIComponent(zoneId)}/workers/routes`,
      { method: 'POST', body: JSON.stringify({ pattern, script: scriptName }) },
    );
    return res.result;
  }

  async deleteWorkerRoute(zoneId: string, routeId: string): Promise<void> {
    await this.request(
      `/zones/${encodeURIComponent(zoneId)}/workers/routes/${encodeURIComponent(routeId)}`,
      { method: 'DELETE' },
    );
  }

  /* ------------------------------ storage resources ---------------------------- */

  async listKvNamespaces(): Promise<CfKvNamespace[]> {
    const res = await this.request<CfKvNamespace[]>(
      `/accounts/${this.accountId}/storage/kv/namespaces?per_page=100`,
    );
    return res.result ?? [];
  }

  async listD1Databases(): Promise<CfD1Database[]> {
    const res = await this.request<CfD1Database[]>(
      `/accounts/${this.accountId}/d1/database?per_page=100`,
    );
    return res.result ?? [];
  }

  async listR2Buckets(): Promise<CfR2Bucket[]> {
    const res = await this.request<{ buckets: CfR2Bucket[] }>(
      `/accounts/${this.accountId}/r2/buckets`,
    );
    const result = res.result as unknown as { buckets?: CfR2Bucket[] } | CfR2Bucket[];
    if (Array.isArray(result)) return result;
    return result?.buckets ?? [];
  }
}
