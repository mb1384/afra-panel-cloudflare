import {
  buildSubscription,
  parseNodeRow,
  subscriptionDenyReason,
} from '@afra/shared';
import type {
  DnsServerRecord,
  ProxyNode,
  RoutingRule,
  SubscriptionFormat,
  SubscriptionResult,
  SubscriptionUserView,
} from '@afra/shared';
import type { Bindings } from '../../core/env.js';
import type { AfraSettings } from '../../core/settings.js';
import { rowToDnsServer, rowToRoutingRule } from '../../db/mappers.js';

export interface SubscriptionUrls {
  token: string;
  subscriptionUrl: string;
  autoUrl: string;
  base64Url: string;
  clashUrl: string;
}

/**
 * ساخت لینک‌های اشتراک. اگر آدرس Worker لبه تنظیم شده باشد از آن استفاده
 * می‌شود؛ در غیر این صورت از دامنهٔ همین پنل (که خودش هم /sub را سرو می‌کند).
 */
export function buildSubscriptionUrls(
  token: string,
  edgeUrl: string,
  requestUrl: string,
): SubscriptionUrls {
  const base = (edgeUrl && edgeUrl.trim() ? edgeUrl.trim() : new URL(requestUrl).origin).replace(
    /\/+$/,
    '',
  );
  const subscriptionUrl = `${base}/sub/${token}`;
  return {
    token,
    subscriptionUrl,
    autoUrl: `${subscriptionUrl}?format=auto`,
    base64Url: `${subscriptionUrl}?format=base64`,
    clashUrl: `${subscriptionUrl}?format=clash`,
  };
}

export interface SubscriptionContext {
  user: SubscriptionUserView;
  subscriptionId: string;
  format: SubscriptionFormat;
  revokedAt: string | null;
}

export async function findSubscriptionByToken(
  env: Bindings,
  token: string,
): Promise<SubscriptionContext | null> {
  const row = await env.AFRA_DB.prepare(
    `SELECT s.id AS subscription_id, s.format, s.revoked_at,
            u.id AS user_id, u.name, u.username, u.credential_uuid, u.trojan_password,
            u.ss_password, u.enabled, u.quota_bytes, u.used_bytes, u.expires_at
       FROM subscriptions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
  )
    .bind(token)
    .first<{
      subscription_id: string;
      format: string;
      revoked_at: string | null;
      user_id: string;
      name: string;
      username: string;
      credential_uuid: string;
      trojan_password: string;
      ss_password: string;
      enabled: number;
      quota_bytes: number | null;
      used_bytes: number;
      expires_at: string | null;
    }>();

  if (!row) return null;
  return {
    subscriptionId: row.subscription_id,
    format: (row.format as SubscriptionFormat) ?? 'auto',
    revokedAt: row.revoked_at,
    user: {
      id: row.user_id,
      name: row.name,
      username: row.username,
      credentialUuid: row.credential_uuid,
      trojanPassword: row.trojan_password,
      ssPassword: row.ss_password,
      enabled: row.enabled === 1,
      quotaBytes: row.quota_bytes,
      usedBytes: row.used_bytes ?? 0,
      expiresAt: row.expires_at,
    },
  };
}

export async function loadNodesForUser(env: Bindings, userId: string): Promise<ProxyNode[]> {
  const assigned = await env.AFRA_DB.prepare(
    `SELECT n.* FROM nodes n JOIN user_nodes un ON un.node_id = n.id
      WHERE un.user_id = ? AND n.enabled = 1`,
  )
    .bind(userId)
    .all();
  const rows =
    (assigned.results ?? []).length > 0
      ? assigned.results
      : (await env.AFRA_DB.prepare('SELECT * FROM nodes WHERE enabled = 1').all()).results;
  return (rows ?? []).map((row) => parseNodeRow(row as Parameters<typeof parseNodeRow>[0]));
}

export async function loadRoutingRules(env: Bindings): Promise<RoutingRule[]> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT id, name, type, pattern, action, priority, enabled FROM routing_rules WHERE enabled = 1 ORDER BY priority',
  ).all<Parameters<typeof rowToRoutingRule>[0]>();
  return (rows.results ?? []).map(rowToRoutingRule);
}

export async function loadDnsServers(env: Bindings): Promise<DnsServerRecord[]> {
  const rows = await env.AFRA_DB.prepare(
    'SELECT * FROM dns_servers WHERE enabled = 1 ORDER BY is_primary DESC',
  ).all<Parameters<typeof rowToDnsServer>[0]>();
  return (rows.results ?? []).map(rowToDnsServer);
}

export interface RenderOptions {
  requestedFormat: SubscriptionFormat | null;
  userAgent: string | null;
  settings: AfraSettings;
}

export async function renderSubscription(
  env: Bindings,
  context: SubscriptionContext,
  options: RenderOptions,
): Promise<SubscriptionResult> {
  const [nodes, rules, dnsServers] = await Promise.all([
    loadNodesForUser(env, context.user.id),
    loadRoutingRules(env),
    loadDnsServers(env),
  ]);

  return buildSubscription(context.user, nodes, rules, dnsServers, {
    format: options.requestedFormat ?? context.format,
    userAgent: options.userAgent,
    panelName: options.settings.panelName,
    nodeNameTemplate: options.settings.nodeNameTemplate,
    strategy: options.settings.balanceStrategy,
    updateIntervalHours: options.settings.subscriptionUpdateHours,
    enableIpv6: options.settings.enableIpv6,
  });
}

export { subscriptionDenyReason };
