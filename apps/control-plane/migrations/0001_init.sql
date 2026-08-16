-- ============================================================
-- Afra Panel — Migration 0001: طرح اولیهٔ دیتابیس (Cloudflare D1)
-- ============================================================

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  label_fa    TEXT NOT NULL,
  is_system   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE permissions (
  id        TEXT PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE,
  label_fa  TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE admins (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT,
  password_hash       TEXT NOT NULL,   -- PBKDF2-HMAC-SHA256 ($afra-pbkdf2$...)
  totp_secret_enc     TEXT,            -- AES-256-GCM
  totp_enabled        INTEGER NOT NULL DEFAULT 0,
  recovery_code_hash  TEXT,
  role_id             TEXT NOT NULL REFERENCES roles(id),
  enabled             INTEGER NOT NULL DEFAULT 1,
  last_login_at       TEXT,
  password_changed_at TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_admins_username ON admins(username);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 توکن نشست
  csrf_secret TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen_at TEXT
);
CREATE INDEX idx_sessions_admin ON sessions(admin_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  ip          TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_login_attempts_lookup ON login_attempts(username, created_at);

-- ------------------------------------------------------------
-- کاربران و اشتراک‌ها
-- ------------------------------------------------------------

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  username          TEXT NOT NULL UNIQUE,
  description       TEXT,
  credential_uuid   TEXT NOT NULL,
  trojan_password   TEXT NOT NULL,
  ss_password       TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  quota_bytes       INTEGER,          -- NULL = نامحدود
  daily_quota_bytes INTEGER,
  used_bytes        INTEGER NOT NULL DEFAULT 0,
  daily_used_bytes  INTEGER NOT NULL DEFAULT 0,
  daily_reset_at    TEXT,
  expires_at        TEXT,
  last_activity_at  TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_users_enabled_expires ON users(enabled, expires_at);
CREATE INDEX idx_users_uuid ON users(credential_uuid);
CREATE INDEX idx_users_created ON users(created_at);

CREATE TABLE subscriptions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  format         TEXT NOT NULL DEFAULT 'auto',
  revoked_at     TEXT,
  rotated_at     TEXT,
  last_access_at TEXT,
  access_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_subscriptions_token ON subscriptions(token);

-- ------------------------------------------------------------
-- سرورها (Nodes)
-- ------------------------------------------------------------

CREATE TABLE nodes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'cloudflare-edge', -- cloudflare-edge | external
  country        TEXT,
  city           TEXT,
  flag           TEXT,
  hostname       TEXT NOT NULL,
  ip             TEXT,
  port           INTEGER NOT NULL DEFAULT 443,
  protocol       TEXT NOT NULL DEFAULT 'vless',
  transport_json TEXT NOT NULL DEFAULT '{"kind":"ws","path":"/afra"}',
  tls_json       TEXT NOT NULL DEFAULT '{"mode":"tls"}',
  cf_worker_name TEXT,
  cf_route_host  TEXT,
  priority       INTEGER NOT NULL DEFAULT 1,
  weight         INTEGER NOT NULL DEFAULT 50,
  enabled        INTEGER NOT NULL DEFAULT 1,
  health         TEXT NOT NULL DEFAULT 'unknown',
  latency_ms     INTEGER,
  last_check_at  TEXT,
  success_count  INTEGER NOT NULL DEFAULT 0,
  failure_count  INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_nodes_enabled_health ON nodes(enabled, health, priority);
CREATE INDEX idx_nodes_kind ON nodes(kind);

CREATE TABLE user_nodes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, node_id)
);
CREATE INDEX idx_user_nodes_node ON user_nodes(node_id);

CREATE TABLE node_health_checks (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ok          INTEGER NOT NULL,
  latency_ms  INTEGER,
  state       TEXT NOT NULL,
  error       TEXT,
  checked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_health_node_time ON node_health_checks(node_id, checked_at);

-- ------------------------------------------------------------
-- مسیریابی، DNS، فیلترینگ
-- ------------------------------------------------------------

CREATE TABLE routing_rules (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  pattern    TEXT NOT NULL,
  action     TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 100,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_routing_priority ON routing_rules(enabled, priority);

CREATE TABLE dns_servers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  address       TEXT NOT NULL,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  is_fallback   INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  supports_ipv6 INTEGER NOT NULL DEFAULT 0,
  health        TEXT NOT NULL DEFAULT 'unknown',
  latency_ms    INTEGER,
  last_check_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE domain_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  entries     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  entry_count INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ------------------------------------------------------------
-- زنجیرهٔ پروکسی، بک‌اند، WARP
-- ------------------------------------------------------------

CREATE TABLE proxy_chains (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  hops_json  TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE backends (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  auth_type     TEXT NOT NULL DEFAULT 'bearer',
  secret_enc    TEXT,                -- AES-256-GCM
  enabled       INTEGER NOT NULL DEFAULT 1,
  is_fallback   INTEGER NOT NULL DEFAULT 0,
  health        TEXT NOT NULL DEFAULT 'unknown',
  latency_ms    INTEGER,
  last_check_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE warp_configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  route_mode    TEXT NOT NULL DEFAULT 'off',
  health        TEXT NOT NULL DEFAULT 'unknown',
  latency_ms    INTEGER,
  last_check_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ------------------------------------------------------------
-- تلگرام، اعلان‌ها، رویدادها
-- ------------------------------------------------------------

CREATE TABLE telegram_admins (
  id          TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  label       TEXT,
  role        TEXT NOT NULL DEFAULT 'read_only',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_notifications_created ON notifications(created_at);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  admin_id      TEXT,
  admin_username TEXT,
  action        TEXT NOT NULL,
  resource      TEXT,
  resource_id   TEXT,
  result        TEXT NOT NULL DEFAULT 'success',
  ip            TEXT,
  metadata      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_audit_action_time ON audit_logs(action, created_at);
CREATE INDEX idx_audit_time ON audit_logs(created_at);

CREATE TABLE app_logs (
  id         TEXT PRIMARY KEY,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  context    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_app_logs_time ON app_logs(created_at);

-- ------------------------------------------------------------
-- تنظیمات، پشتیبان، تحلیل، منابع Cloudflare
-- ------------------------------------------------------------

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,     -- JSON
  is_secret  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE backups (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  encrypted    INTEGER NOT NULL DEFAULT 1,
  has_secrets  INTEGER NOT NULL DEFAULT 0,
  table_counts TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE traffic_samples (
  id        TEXT PRIMARY KEY,
  user_id   TEXT,
  node_id   TEXT,
  bytes     INTEGER NOT NULL DEFAULT 0,
  bucket_at TEXT NOT NULL
);
CREATE INDEX idx_traffic_bucket ON traffic_samples(bucket_at);
CREATE INDEX idx_traffic_user ON traffic_samples(user_id, bucket_at);

CREATE TABLE cf_resources (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,    -- worker | dns_record | route | kv | d1 | r2
  cf_id       TEXT,
  name        TEXT NOT NULL,
  zone_id     TEXT,
  node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_cf_resources_kind ON cf_resources(kind);
