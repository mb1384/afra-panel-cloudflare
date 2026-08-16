/**
 * تولید کد Worker برای endpointهای مدیریت‌شدهٔ Cloudflare.
 * این کد از طریق Cloudflare API منتشر می‌شود و به همان D1 و KV پنل bind می‌گردد.
 */
const ENDPOINT_TEMPLATE = String.raw`// ============================================================
// Afra Panel — Generated Cloudflare Endpoint Worker
// این فایل توسط پنل افرا تولید و از طریق Cloudflare API منتشر می‌شود.
// مسئولیت: پذیرش اتصال VLESS-over-WebSocket و اتصال به مقصد.
// منطق آن آیینهٔ apps/edge/src/vless.ts است (نسخهٔ خودبسندهٔ JS).
// ============================================================
import { connect } from 'cloudflare:sockets';

const EDGE_PATH = __AFRA_PATH__;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes) {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function parseVlessHeader(buffer) {
  if (buffer.length < 24) throw new Error('header too short');
  const version = buffer[0];
  const uuid = bytesToUuid(buffer.subarray(1, 17));
  const optionsLength = buffer[17];
  const commandIndex = 18 + optionsLength;
  if (buffer.length < commandIndex + 4) throw new Error('header truncated');
  const command = buffer[commandIndex];
  const port = (buffer[commandIndex + 1] << 8) | buffer[commandIndex + 2];
  const addressType = buffer[commandIndex + 3];
  let cursor = commandIndex + 4;
  let address = '';
  if (addressType === 1) {
    address = Array.from(buffer.subarray(cursor, cursor + 4)).join('.');
    cursor += 4;
  } else if (addressType === 2) {
    const length = buffer[cursor];
    cursor += 1;
    address = new TextDecoder().decode(buffer.subarray(cursor, cursor + length));
    cursor += length;
  } else if (addressType === 3) {
    const groups = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset + cursor, 16);
    for (let i = 0; i < 8; i += 1) groups.push(view.getUint16(i * 2).toString(16));
    address = groups.join(':');
    cursor += 16;
  } else {
    throw new Error('bad address type');
  }
  return { version, uuid, command, port, address, payload: buffer.subarray(cursor) };
}

async function authorize(env, uuid) {
  if (!UUID_RE.test(uuid)) return { allowed: false };
  const key = 'edge:user:' + uuid.toLowerCase();
  const cached = await env.AFRA_KV.get(key, 'json').catch(() => null);
  if (cached) return { allowed: cached.allowed === true, userId: cached.userId };

  if (!env.AFRA_DB) return { allowed: false };
  const row = await env.AFRA_DB.prepare(
    'SELECT id, enabled, quota_bytes, used_bytes, expires_at FROM users WHERE credential_uuid = ?',
  )
    .bind(uuid.toLowerCase())
    .first();
  if (!row) {
    await env.AFRA_KV.put(key, JSON.stringify({ allowed: false, userId: '' }), { expirationTtl: 60 }).catch(() => {});
    return { allowed: false };
  }
  const expired = row.expires_at ? Date.parse(row.expires_at) <= Date.now() : false;
  const exhausted = row.quota_bytes !== null && (row.used_bytes || 0) >= row.quota_bytes;
  const allowed = row.enabled === 1 && !expired && !exhausted;
  await env.AFRA_KV.put(key, JSON.stringify({ allowed, userId: row.id }), { expirationTtl: 60 }).catch(() => {});
  return { allowed, userId: row.id };
}

async function recordTraffic(env, userId, bytes) {
  if (!env.AFRA_DB || !userId || bytes <= 0) return;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bucket = new Date();
  bucket.setUTCMinutes(0, 0, 0);
  try {
    await env.AFRA_DB.batch([
      env.AFRA_DB.prepare(
        'UPDATE users SET used_bytes = used_bytes + ?, daily_used_bytes = daily_used_bytes + ?, last_activity_at = ? WHERE id = ?',
      ).bind(bytes, bytes, now, userId),
      env.AFRA_DB.prepare(
        'INSERT INTO traffic_samples (id, user_id, node_id, bytes, bucket_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(
        'trf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        userId,
        null,
        bytes,
        bucket.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ),
    ]);
  } catch (error) {
    console.error('traffic record failed');
  }
}

async function runSession(server, firstChunk, env) {
  const header = parseVlessHeader(firstChunk);
  const auth = await authorize(env, header.uuid);
  if (!auth.allowed) {
    server.close(1008, 'unauthorized');
    return;
  }
  if (header.command !== 1) {
    server.close(1003, 'only tcp supported');
    return;
  }

  const socket = connect({ hostname: header.address, port: header.port }, { allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  let transferred = header.payload.length;
  if (header.payload.length > 0) await writer.write(header.payload);

  server.addEventListener('message', (event) => {
    const chunk =
      event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new TextEncoder().encode(String(event.data));
    transferred += chunk.length;
    writer.write(chunk).catch(() => {
      try { server.close(1011, 'write failed'); } catch (e) {}
    });
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { writer.close(); } catch (e) {}
    try { server.close(1000, 'closed'); } catch (e) {}
  };
  server.addEventListener('close', finish);
  server.addEventListener('error', finish);

  server.send(new Uint8Array([header.version, 0]).buffer);

  const reader = socket.readable.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value) {
        transferred += chunk.value.byteLength;
        server.send(chunk.value.buffer ? chunk.value.buffer : chunk.value);
      }
    }
  } catch (error) {
    // اتصال مقصد بسته شد
  } finally {
    finish();
  }
  return { userId: auth.userId, bytes: transferred };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'afra-endpoint' });
    }

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('پنل افرا — این endpoint فقط برای اتصال کلاینت است.', { status: 404 });
    }
    if (url.pathname !== EDGE_PATH) {
      return new Response('یافت نشد.', { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const session = new Promise((resolve) => {
      const onFirst = (event) => {
        server.removeEventListener('message', onFirst);
        const chunk =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new TextEncoder().encode(String(event.data));
        runSession(server, chunk, env)
          .then((result) => {
            if (result && result.userId) ctx.waitUntil(recordTraffic(env, result.userId, result.bytes));
          })
          .catch(() => {
            try { server.close(1011, 'session error'); } catch (e) {}
          })
          .finally(resolve);
      };
      server.addEventListener('message', onFirst);
      server.addEventListener('close', () => resolve());
      server.addEventListener('error', () => resolve());
    });

    ctx.waitUntil(session);
    return new Response(null, { status: 101, webSocket: client });
  },
};
`;

export interface EndpointScriptOptions {
  /** مسیر WebSocket که کلاینت به آن متصل می‌شود، مثال: /afra */
  path: string;
}

export function buildEndpointScript(options: EndpointScriptOptions): string {
  const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
  return ENDPOINT_TEMPLATE.replace(/__AFRA_PATH__/g, JSON.stringify(path));
}

export const ENDPOINT_SCRIPT_VERSION = '1.0.0';
