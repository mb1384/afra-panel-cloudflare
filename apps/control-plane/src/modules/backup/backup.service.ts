import { AfraError } from '@afra/shared';
import { decryptBytes, encryptBytes } from '../../core/crypto.js';
import type { Bindings } from '../../core/env.js';
import { newId, nowIso } from '../../core/ids.js';

/** ترتیب جداول برای حفظ یکپارچگی ارجاعی در بازگردانی. */
export const BACKUP_TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'admins',
  'users',
  'nodes',
  'user_nodes',
  'subscriptions',
  'routing_rules',
  'dns_servers',
  'domain_filters',
  'proxy_chains',
  'backends',
  'warp_configs',
  'telegram_admins',
  'system_settings',
] as const;

/** ستون‌هایی که در پشتیبان بدون اسرار حذف می‌شوند. */
const SECRET_COLUMNS: Record<string, string[]> = {
  admins: ['password_hash', 'totp_secret_enc', 'recovery_code_hash'],
  backends: ['secret_enc'],
  users: ['credential_uuid', 'trojan_password', 'ss_password'],
  subscriptions: ['token'],
};

export interface BackupPayload {
  meta: {
    version: string;
    createdAt: string;
    includeSecrets: boolean;
    tables: string[];
  };
  data: Record<string, Record<string, unknown>[]>;
}

export async function createBackupPayload(
  env: Bindings,
  includeSecrets: boolean,
): Promise<BackupPayload> {
  const data: Record<string, Record<string, unknown>[]> = {};

  for (const table of BACKUP_TABLES) {
    const rows = await env.AFRA_DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
    const results = rows.results ?? [];
    if (includeSecrets) {
      data[table] = results;
      continue;
    }
    const drop = SECRET_COLUMNS[table] ?? [];
    data[table] = results.map((row) => {
      const clone: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (drop.includes(key)) continue;
        clone[key] = value;
      }
      return clone;
    });
  }

  // تنظیمات محرمانه هرگز در پشتیبان بدون اسرار قرار نمی‌گیرند
  if (!includeSecrets && data.system_settings) {
    data.system_settings = data.system_settings.filter((row) => row.is_secret !== 1);
  }

  return {
    meta: {
      version: '1.0.0',
      createdAt: nowIso(),
      includeSecrets,
      tables: [...BACKUP_TABLES],
    },
    data,
  };
}

export interface StoredBackup {
  id: string;
  key: string;
  sizeBytes: number;
  encrypted: boolean;
  hasSecrets: boolean;
}

export async function storeBackup(
  env: Bindings,
  payload: BackupPayload,
  options: { encrypt: boolean; passphrase?: string; createdBy?: string | null },
): Promise<StoredBackup> {
  if (!env.AFRA_BACKUPS) throw new AfraError('BACKUP_NOT_CONFIGURED', 400);
  if (options.encrypt && !options.passphrase) {
    throw new AfraError('VALIDATION_ERROR', 422, { reason: 'passphrase_required' });
  }

  const json = JSON.stringify(payload);
  const raw = new TextEncoder().encode(json);
  const bytes: Uint8Array =
    options.encrypt && options.passphrase ? await encryptBytes(raw, options.passphrase) : raw;
  // R2 به ArrayBuffer مستقل نیاز دارد (نه view روی بافر مشترک)
  const body = bytes.slice().buffer as ArrayBuffer;

  const id = newId('bkp');
  const key = `backups/${nowIso().replace(/[:]/g, '-')}-${id}.${options.encrypt ? 'afra' : 'json'}`;

  await env.AFRA_BACKUPS.put(key, body, {
    httpMetadata: {
      contentType: options.encrypt ? 'application/octet-stream' : 'application/json',
    },
    customMetadata: {
      encrypted: String(options.encrypt),
      hasSecrets: String(payload.meta.includeSecrets),
    },
  });

  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(payload.data)) counts[table] = rows.length;

  await env.AFRA_DB.prepare(
    `INSERT INTO backups (id, r2_key, size_bytes, encrypted, has_secrets, table_counts, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      key,
      body.byteLength,
      options.encrypt ? 1 : 0,
      payload.meta.includeSecrets ? 1 : 0,
      JSON.stringify(counts),
      options.createdBy ?? null,
      nowIso(),
    )
    .run();

  return {
    id,
    key,
    sizeBytes: body.byteLength,
    encrypted: options.encrypt,
    hasSecrets: payload.meta.includeSecrets,
  };
}

export async function loadBackup(
  env: Bindings,
  key: string,
  passphrase?: string,
): Promise<BackupPayload> {
  if (!env.AFRA_BACKUPS) throw new AfraError('BACKUP_NOT_CONFIGURED', 400);
  const object = await env.AFRA_BACKUPS.get(key);
  if (!object) throw new AfraError('BACKUP_NOT_FOUND', 404);

  const buffer = new Uint8Array(await object.arrayBuffer());
  const looksEncrypted = new TextDecoder().decode(buffer.subarray(0, 5)) === 'AFRA1';

  let jsonBytes: Uint8Array<ArrayBufferLike> = buffer;
  if (looksEncrypted) {
    if (!passphrase) throw new AfraError('VALIDATION_ERROR', 422, { reason: 'passphrase_required' });
    const decrypted = await decryptBytes(buffer, passphrase);
    if (!decrypted) throw new AfraError('RESTORE_FAILED', 400, { reason: 'bad_passphrase' });
    jsonBytes = decrypted;
  }

  try {
    return JSON.parse(new TextDecoder().decode(jsonBytes)) as BackupPayload;
  } catch {
    throw new AfraError('RESTORE_FAILED', 400, { reason: 'invalid_payload' });
  }
}

/** هدف تعارض برای upsert غیرمخرب هر جدول. */
const CONFLICT_TARGET: Record<string, string> = {
  roles: 'id',
  permissions: 'id',
  role_permissions: 'role_id, permission_id',
  admins: 'id',
  users: 'id',
  nodes: 'id',
  user_nodes: 'user_id, node_id',
  subscriptions: 'id',
  routing_rules: 'id',
  dns_servers: 'id',
  domain_filters: 'id',
  proxy_chains: 'id',
  backends: 'id',
  warp_configs: 'id',
  telegram_admins: 'id',
  system_settings: 'key',
};

/**
 * ستون‌های NOT NULL که در پشتیبان بدون اسرار حذف می‌شوند؛ بنابراین آن جداول
 * از پشتیبان بدون اسرار قابل بازگردانی نیستند و صریحاً رد می‌شوند.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  admins: ['password_hash'],
  users: ['credential_uuid', 'trojan_password', 'ss_password'],
  subscriptions: ['token'],
};

export interface RestoreSkip {
  table: string;
  reason: 'empty' | 'missing_secret_columns';
  messageFa: string;
}

export interface RestoreReport {
  restored: Record<string, number>;
  skipped: RestoreSkip[];
}

export async function restoreBackup(
  env: Bindings,
  payload: BackupPayload,
  options: { wipeExisting: boolean },
): Promise<RestoreReport> {
  if (!payload.data || typeof payload.data !== 'object') {
    throw new AfraError('RESTORE_FAILED', 400, { reason: 'invalid_payload' });
  }

  const restored: Record<string, number> = {};
  const skipped: RestoreSkip[] = [];

  if (options.wipeExisting) {
    // ترتیب معکوس برای رعایت ارجاع‌ها
    for (const table of [...BACKUP_TABLES].reverse()) {
      if (table === 'roles' || table === 'permissions' || table === 'role_permissions') continue;
      await env.AFRA_DB.prepare(`DELETE FROM ${table}`).run();
    }
  }

  for (const table of BACKUP_TABLES) {
    const rows = payload.data[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      skipped.push({ table, reason: 'empty', messageFa: `جدول ${table} داده‌ای نداشت.` });
      continue;
    }

    const columns = Object.keys(rows[0] ?? {});
    const required = REQUIRED_COLUMNS[table] ?? [];
    const missing = required.filter((column) => !columns.includes(column));
    if (missing.length > 0) {
      skipped.push({
        table,
        reason: 'missing_secret_columns',
        messageFa: `جدول ${table} از پشتیبان بدون اسرار قابل بازگردانی نیست (ستون‌های ${missing.join(', ')} حذف شده‌اند).`,
      });
      continue;
    }

    const conflictTarget = CONFLICT_TARGET[table] ?? 'id';
    const conflictColumns = conflictTarget.split(',').map((column) => column.trim());
    let inserted = 0;
    const chunkSize = 40;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const statements = chunk
        .map((row) => {
          const rowColumns = Object.keys(row);
          if (rowColumns.length === 0) return null;
          const placeholders = rowColumns.map(() => '?').join(', ');
          const updatable = rowColumns.filter((column) => !conflictColumns.includes(column));
          // upsert غیرمخرب: مقادیر موجود (مثل هش گذرواژه) از دست نمی‌روند
          const conflictClause =
            updatable.length > 0
              ? `ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updatable
                  .map((column) => `${column} = excluded.${column}`)
                  .join(', ')}`
              : `ON CONFLICT(${conflictTarget}) DO NOTHING`;
          return env.AFRA_DB.prepare(
            `INSERT INTO ${table} (${rowColumns.join(', ')}) VALUES (${placeholders}) ${conflictClause}`,
          ).bind(...rowColumns.map((column) => row[column] ?? null));
        })
        .filter((statement): statement is D1PreparedStatement => statement !== null);

      if (statements.length > 0) {
        await env.AFRA_DB.batch(statements);
        inserted += statements.length;
      }
    }
    restored[table] = inserted;
  }

  return { restored, skipped };
}
