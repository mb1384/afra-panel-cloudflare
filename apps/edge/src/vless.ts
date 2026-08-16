import { connect } from 'cloudflare:sockets';

/**
 * پیاده‌سازی inbound پروتکل VLESS روی WebSocket برای اجرا در Cloudflare Workers.
 *
 * محدودیت‌های آگاهانه:
 *  - فقط دستور TCP (0x01) پشتیبانی می‌شود؛ UDP در محیط Workers قابل پراکسی نیست.
 *  - احراز هویت فقط با UUIDهایی که مدیر در پنل ایجاد کرده انجام می‌شود (allowlist در KV).
 */

export interface VlessHeader {
  version: number;
  uuid: string;
  command: number;
  port: number;
  address: string;
  payload: Uint8Array;
}

const COMMAND_TCP = 0x01;

function bytesToUuid(bytes: Uint8Array): string {
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

/** تجزیهٔ هدر VLESS. در صورت نامعتبر بودن، خطا پرتاب می‌شود. */
export function parseVlessHeader(buffer: Uint8Array): VlessHeader {
  if (buffer.length < 24) throw new Error('vless header too short');

  const version = buffer[0];
  const uuid = bytesToUuid(buffer.subarray(1, 17));
  const optionsLength = buffer[17];
  const commandIndex = 18 + optionsLength;
  if (buffer.length < commandIndex + 4) throw new Error('vless header truncated');

  const command = buffer[commandIndex];
  const port = (buffer[commandIndex + 1] << 8) | buffer[commandIndex + 2];
  const addressType = buffer[commandIndex + 3];
  let cursor = commandIndex + 4;
  let address = '';

  if (addressType === 0x01) {
    if (buffer.length < cursor + 4) throw new Error('ipv4 address truncated');
    address = Array.from(buffer.subarray(cursor, cursor + 4)).join('.');
    cursor += 4;
  } else if (addressType === 0x02) {
    const length = buffer[cursor];
    cursor += 1;
    if (buffer.length < cursor + length) throw new Error('domain address truncated');
    address = new TextDecoder().decode(buffer.subarray(cursor, cursor + length));
    cursor += length;
  } else if (addressType === 0x03) {
    if (buffer.length < cursor + 16) throw new Error('ipv6 address truncated');
    const groups: string[] = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset + cursor, 16);
    for (let i = 0; i < 8; i += 1) groups.push(view.getUint16(i * 2).toString(16));
    address = groups.join(':');
    cursor += 16;
  } else {
    throw new Error(`unsupported address type: ${addressType}`);
  }

  return {
    version,
    uuid,
    command,
    port,
    address,
    payload: buffer.subarray(cursor),
  };
}

export interface VlessAuthResult {
  allowed: boolean;
  userId?: string;
  reason?: string;
}

/** پیوند WebSocket کلاینت با اتصال TCP مقصد. */
export async function handleVlessSession(
  server: WebSocket,
  firstChunk: Uint8Array,
  authorize: (uuid: string) => Promise<VlessAuthResult>,
  onTraffic?: (userId: string, bytes: number) => void,
): Promise<void> {
  const header = parseVlessHeader(firstChunk);
  const auth = await authorize(header.uuid);
  if (!auth.allowed) {
    server.close(1008, 'unauthorized');
    return;
  }
  if (header.command !== COMMAND_TCP) {
    server.close(1003, 'only tcp supported');
    return;
  }

  const socket = connect(
    { hostname: header.address, port: header.port },
    { allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();

  let uploaded = header.payload.length;
  let downloaded = 0;

  if (header.payload.length > 0) {
    await writer.write(header.payload as unknown as ArrayBufferView);
  }

  server.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    const chunk =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new TextEncoder().encode(String(data));
    uploaded += chunk.length;
    writer.write(chunk as unknown as ArrayBufferView).catch(() => {
      try {
        server.close(1011, 'upstream write failed');
      } catch {
        /* بستن اتصال شکست خورد */
      }
    });
  });

  const closeAll = (): void => {
    if (auth.userId && onTraffic) onTraffic(auth.userId, uploaded + downloaded);
    try {
      writer.close();
    } catch {
      /* نادیده */
    }
    try {
      server.close(1000, 'closed');
    } catch {
      /* نادیده */
    }
  };

  server.addEventListener('close', closeAll);
  server.addEventListener('error', closeAll);

  // پاسخ هدر VLESS: [version, addonLength]
  server.send(new Uint8Array([header.version, 0]).buffer);

  const reader = socket.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        downloaded += value.byteLength;
        server.send(value.buffer ?? value);
      }
    }
  } catch {
    // اتصال مقصد قطع شد
  } finally {
    closeAll();
  }
}
