import { isExpired, isQuotaExhausted, parseSize } from '@afra/shared';
import type { PanelUser } from '@afra/shared';
import type { Bindings } from '../../core/env.js';
import { isoPlusDays, newId, newPassword, newToken, newUuid, nowIso } from '../../core/ids.js';
import type { UserRow } from '../../db/mappers.js';
import { likePattern, rowToUser } from '../../db/mappers.js';

export interface UserListFilters {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order: 'asc' | 'desc';
  state: 'all' | 'active' | 'disabled' | 'expired' | 'exhausted';
  tag?: string;
  nodeId?: string;
}

const SORTABLE: Record<string, string> = {
  createdAt: 'u.created_at',
  name: 'u.name',
  username: 'u.username',
  usedBytes: 'u.used_bytes',
  expiresAt: 'u.expires_at',
  lastActivityAt: 'u.last_activity_at',
};

const SELECT_USER = `
  SELECT u.*, (
    SELECT GROUP_CONCAT(un.node_id) FROM user_nodes un WHERE un.user_id = u.id
  ) AS node_ids
  FROM users u`;

export async function listUsers(
  env: Bindings,
  filters: UserListFilters,
): Promise<{ items: PanelUser[]; total: number }> {
  const now = nowIso();
  const conditions: string[] = [];
  const bindParams: unknown[] = [];

  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push("(u.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    bindParams.push(pattern, pattern);
  }

  if (filters.state === 'active') {
    conditions.push(
      'u.enabled = 1 AND (u.expires_at IS NULL OR u.expires_at > ?) AND (u.quota_bytes IS NULL OR u.used_bytes < u.quota_bytes)',
    );
    bindParams.push(now);
  } else if (filters.state === 'disabled') {
    conditions.push('u.enabled = 0');
  } else if (filters.state === 'expired') {
    conditions.push('u.expires_at IS NOT NULL AND u.expires_at <= ?');
    bindParams.push(now);
  } else if (filters.state === 'exhausted') {
    conditions.push('u.quota_bytes IS NOT NULL AND u.used_bytes >= u.quota_bytes');
  }

  if (filters.tag) {
    conditions.push('u.tags LIKE ?');
    bindParams.push(`%"${filters.tag}"%`);
  }

  if (filters.nodeId) {
    conditions.push(
      'EXISTS (SELECT 1 FROM user_nodes un2 WHERE un2.user_id = u.id AND un2.node_id = ?)',
    );
    bindParams.push(filters.nodeId);
  }

  const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const orderColumn = SORTABLE[filters.sort ?? 'createdAt'] ?? 'u.created_at';
  const orderDir = filters.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (filters.page - 1) * filters.pageSize;

  const rows = await env.AFRA_DB.prepare(
    `${SELECT_USER}${whereSql} ORDER BY ${orderColumn} ${orderDir} LIMIT ? OFFSET ?`,
  )
    .bind(...bindParams, filters.pageSize, offset)
    .all<UserRow>();

  const countRow = await env.AFRA_DB.prepare(`SELECT COUNT(*) AS total FROM users u${whereSql}`)
    .bind(...bindParams)
    .first<{ total: number }>();

  return {
    items: (rows.results ?? []).map(rowToUser),
    total: countRow?.total ?? 0,
  };
}

export async function getUserById(env: Bindings, id: string): Promise<PanelUser | null> {
  const row = await env.AFRA_DB.prepare(`${SELECT_USER} WHERE u.id = ?`)
    .bind(id)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export interface CreateUserInput {
  name: string;
  username: string;
  description?: string | null;
  quota?: string | null;
  dailyQuota?: string | null;
  expiresAt?: string | null;
  expiresInDays?: number | null;
  enabled: boolean;
  tags: string[];
  nodeIds: string[];
  subscriptionFormat: 'auto' | 'base64' | 'clash';
}

export async function createUser(
  env: Bindings,
  input: CreateUserInput,
): Promise<{ user: PanelUser; subscriptionToken: string }> {
  const id = newId('usr');
  const uuid = newUuid();
  const expiresAt =
    input.expiresAt ??
    (input.expiresInDays && input.expiresInDays > 0 ? isoPlusDays(input.expiresInDays) : null);
  const token = newToken(32);

  const statements = [
    env.AFRA_DB.prepare(
      `INSERT INTO users (id, name, username, description, credential_uuid, trojan_password, ss_password,
                          enabled, quota_bytes, daily_quota_bytes, used_bytes, daily_used_bytes,
                          daily_reset_at, expires_at, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      input.name,
      input.username,
      input.description ?? null,
      uuid,
      newPassword(16),
      newPassword(16),
      input.enabled ? 1 : 0,
      parseSize(input.quota ?? null),
      parseSize(input.dailyQuota ?? null),
      isoPlusDays(1),
      expiresAt,
      JSON.stringify(input.tags ?? []),
      nowIso(),
      nowIso(),
    ),
    env.AFRA_DB.prepare(
      'INSERT INTO subscriptions (id, user_id, token, format, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(newId('sub'), id, token, input.subscriptionFormat, nowIso()),
  ];

  for (const nodeId of input.nodeIds ?? []) {
    statements.push(
      env.AFRA_DB.prepare(
        'INSERT OR IGNORE INTO user_nodes (user_id, node_id) VALUES (?, ?)',
      ).bind(id, nodeId),
    );
  }

  await env.AFRA_DB.batch(statements);
  await invalidateUserCache(env, uuid);

  const user = await getUserById(env, id);
  if (!user) throw new Error('user creation failed');
  return { user, subscriptionToken: token };
}

export async function updateUser(
  env: Bindings,
  id: string,
  input: Partial<CreateUserInput>,
): Promise<PanelUser | null> {
  const existing = await getUserById(env, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  const push = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) push('name', input.name);
  if (input.username !== undefined) push('username', input.username);
  if (input.description !== undefined) push('description', input.description ?? null);
  if (input.quota !== undefined) push('quota_bytes', parseSize(input.quota ?? null));
  if (input.dailyQuota !== undefined) push('daily_quota_bytes', parseSize(input.dailyQuota ?? null));
  if (input.enabled !== undefined) push('enabled', input.enabled ? 1 : 0);
  if (input.tags !== undefined) push('tags', JSON.stringify(input.tags));
  if (input.expiresAt !== undefined) push('expires_at', input.expiresAt ?? null);
  else if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    push('expires_at', input.expiresInDays > 0 ? isoPlusDays(input.expiresInDays) : null);
  }

  push('updated_at', nowIso());
  params.push(id);

  await env.AFRA_DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  if (input.nodeIds !== undefined) {
    await env.AFRA_DB.prepare('DELETE FROM user_nodes WHERE user_id = ?').bind(id).run();
    if (input.nodeIds.length > 0) {
      await env.AFRA_DB.batch(
        input.nodeIds.map((nodeId) =>
          env.AFRA_DB.prepare(
            'INSERT OR IGNORE INTO user_nodes (user_id, node_id) VALUES (?, ?)',
          ).bind(id, nodeId),
        ),
      );
    }
  }

  if (input.subscriptionFormat !== undefined) {
    await env.AFRA_DB.prepare('UPDATE subscriptions SET format = ? WHERE user_id = ?')
      .bind(input.subscriptionFormat, id)
      .run();
  }

  await invalidateUserCache(env, existing.credentialUuid);
  return getUserById(env, id);
}

export async function deleteUser(env: Bindings, id: string): Promise<boolean> {
  const user = await getUserById(env, id);
  if (!user) return false;
  await env.AFRA_DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await invalidateUserCache(env, user.credentialUuid);
  return true;
}

export async function resetTraffic(env: Bindings, id: string): Promise<void> {
  await env.AFRA_DB.prepare(
    'UPDATE users SET used_bytes = 0, daily_used_bytes = 0, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), id)
    .run();
  const user = await getUserById(env, id);
  if (user) await invalidateUserCache(env, user.credentialUuid);
}

export async function extendUser(env: Bindings, id: string, days: number): Promise<string | null> {
  const user = await getUserById(env, id);
  if (!user) return null;
  const base =
    user.expiresAt && Date.parse(user.expiresAt) > Date.now() ? new Date(user.expiresAt) : new Date();
  const expiresAt = isoPlusDays(days, base);
  await env.AFRA_DB.prepare('UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(expiresAt, nowIso(), id)
    .run();
  await invalidateUserCache(env, user.credentialUuid);
  return expiresAt;
}

export async function rotateCredentials(env: Bindings, id: string): Promise<PanelUser | null> {
  const user = await getUserById(env, id);
  if (!user) return null;
  const uuid = newUuid();
  await env.AFRA_DB.prepare(
    `UPDATE users SET credential_uuid = ?, trojan_password = ?, ss_password = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(uuid, newPassword(16), newPassword(16), nowIso(), id)
    .run();
  await invalidateUserCache(env, user.credentialUuid);
  await invalidateUserCache(env, uuid);
  return getUserById(env, id);
}

export async function setEnabled(env: Bindings, id: string, enabled: boolean): Promise<void> {
  const user = await getUserById(env, id);
  if (!user) return;
  await env.AFRA_DB.prepare('UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, nowIso(), id)
    .run();
  await invalidateUserCache(env, user.credentialUuid);
}

export function userStateOf(user: PanelUser): 'active' | 'disabled' | 'expired' | 'exhausted' {
  if (!user.enabled) return 'disabled';
  if (isExpired(user.expiresAt)) return 'expired';
  if (isQuotaExhausted(user.quotaBytes, user.usedBytes)) return 'exhausted';
  return 'active';
}

/** حذف کش مجوز در KV تا تغییرات فوراً روی لبه اعمال شود. */
export async function invalidateUserCache(env: Bindings, uuid: string): Promise<void> {
  await env.AFRA_KV.delete(`edge:user:${uuid.toLowerCase()}`).catch(() => undefined);
}
