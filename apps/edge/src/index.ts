import {
  buildSubscription,
  subscriptionDenyReason,
} from '@afra/shared';
import {
  authorizeUuid,
  findDnsServers,
  findNodesForUser,
  findRoutingRules,
  findSubscriptionByToken,
  loadEdgeSettings,
  recordTraffic,
} from './data.js';
import type { EdgeBindings } from './env.js';
import { handleVlessSession } from './vless.js';

/**
 * Afra Edge Worker
 * لایهٔ لبهٔ Cloudflare با دو مسئولیت مشخص:
 *   ۱) تحویل اشتراک (/sub/:token)
 *   ۲) endpoint پروکسی VLESS-over-WebSocket
 * پنل مدیریت و APIهای مدیریتی در ورکر Control Plane قرار دارند.
 */

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

export default {
  async fetch(request: Request, env: EdgeBindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ---------------- endpoint پروکسی (WebSocket) ----------------
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const expectedPath = env.AFRA_EDGE_PATH || '/afra';
      if (url.pathname !== expectedPath) {
        return textResponse('یافت نشد.', 404);
      }
      return handleProxyUpgrade(request, env, ctx);
    }

    // ---------------- سلامت ----------------
    if (url.pathname === '/health') {
      return Response.json(
        { ok: true, service: 'afra-edge', env: env.AFRA_ENV, time: new Date().toISOString() },
        { headers: SECURITY_HEADERS },
      );
    }

    if (url.pathname === '/ready') {
      try {
        await env.AFRA_DB.prepare('SELECT 1').first();
        return Response.json({ ok: true, ready: true }, { headers: SECURITY_HEADERS });
      } catch {
        return Response.json({ ok: false, ready: false }, { status: 503, headers: SECURITY_HEADERS });
      }
    }

    // ---------------- تحویل اشتراک ----------------
    const subMatch = /^\/sub\/([A-Za-z0-9_-]{20,})$/.exec(url.pathname);
    if (subMatch) {
      return handleSubscription(request, env, ctx, subMatch[1], url);
    }

    return textResponse('پنل افرا — سرویس لبه. این مسیر عمومی نیست.', 404);
  },
};

async function handleProxyUpgrade(
  request: Request,
  env: EdgeBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const session = new Promise<void>((resolve) => {
    const onFirstMessage = (event: MessageEvent): void => {
      server.removeEventListener('message', onFirstMessage);
      const data = event.data;
      const chunk =
        data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(String(data));

      handleVlessSession(
        server,
        chunk,
        (uuid) => authorizeUuid(env, uuid),
        (userId, bytes) => {
          ctx.waitUntil(recordTraffic(env, userId, bytes));
        },
      )
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({ level: 'WARN', message: 'vless session failed', error: String(error) }),
          );
          try {
            server.close(1011, 'session error');
          } catch {
            /* اتصال قبلاً بسته شده */
          }
        })
        .finally(resolve);
    };

    server.addEventListener('message', onFirstMessage);
    server.addEventListener('close', () => resolve());
    server.addEventListener('error', () => resolve());
  });

  ctx.waitUntil(session);
  return new Response(null, { status: 101, webSocket: client });
}

async function handleSubscription(
  request: Request,
  env: EdgeBindings,
  ctx: ExecutionContext,
  token: string,
  url: URL,
): Promise<Response> {
  const lookup = await findSubscriptionByToken(env, token);
  if (!lookup) {
    return textResponse('اشتراک یافت نشد.', 404);
  }
  if (lookup.revokedAt) {
    return textResponse('این اشتراک لغو شده است.', 403);
  }

  const deny = subscriptionDenyReason(lookup.user);
  if (deny) {
    const messages: Record<string, string> = {
      disabled: 'حساب کاربری غیرفعال است.',
      expired: 'اشتراک منقضی شده است.',
      exhausted: 'حجم مجاز به پایان رسیده است.',
    };
    return textResponse(messages[deny] ?? 'اشتراک در دسترس نیست.', 403);
  }

  const formatParam = url.searchParams.get('format');
  const requestedFormat =
    formatParam === 'auto' || formatParam === 'base64' || formatParam === 'clash'
      ? formatParam
      : lookup.format;

  const [settings, nodes, rules, dnsServers] = await Promise.all([
    loadEdgeSettings(env),
    findNodesForUser(env, lookup.user.id),
    findRoutingRules(env),
    findDnsServers(env),
  ]);

  const result = buildSubscription(lookup.user, nodes, rules, dnsServers, {
    format: requestedFormat,
    userAgent: request.headers.get('user-agent'),
    panelName: settings.panelName,
    nodeNameTemplate: settings.nodeNameTemplate,
    strategy: settings.balanceStrategy,
    updateIntervalHours: settings.subscriptionUpdateHours,
    enableIpv6: settings.enableIpv6,
  });

  ctx.waitUntil(
    env.AFRA_DB.prepare(
      `UPDATE subscriptions
          SET access_count = access_count + 1, last_access_at = ?
        WHERE id = ?`,
    )
      .bind(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), lookup.subscriptionId)
      .run()
      .then(() => undefined)
      .catch(() => undefined),
  );

  return new Response(result.body, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'cache-control': 'no-store, private',
      ...SECURITY_HEADERS,
      ...result.headers,
    },
  });
}
