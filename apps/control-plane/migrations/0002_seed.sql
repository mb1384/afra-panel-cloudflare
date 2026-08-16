-- ============================================================
-- Afra Panel — Migration 0002: دادهٔ پایه (نقش‌ها، مجوزها، تنظیمات پیش‌فرض)
-- ============================================================

INSERT INTO roles (id, name, label_fa, is_system) VALUES
  ('super_admin', 'super_admin', 'مدیر ارشد', 1),
  ('admin',       'admin',       'مدیر',      1),
  ('read_only',   'read_only',   'فقط خواندنی', 1);

INSERT INTO permissions (id, key, label_fa) VALUES
  ('users.read','users.read','مشاهده کاربران'),
  ('users.write','users.write','ایجاد و ویرایش کاربران'),
  ('users.delete','users.delete','حذف کاربران'),
  ('subscriptions.read','subscriptions.read','مشاهده اشتراک‌ها'),
  ('subscriptions.write','subscriptions.write','مدیریت اشتراک‌ها'),
  ('nodes.read','nodes.read','مشاهده سرورها'),
  ('nodes.write','nodes.write','ایجاد و ویرایش سرورها'),
  ('nodes.delete','nodes.delete','حذف سرورها'),
  ('routing.read','routing.read','مشاهده قواعد مسیریابی'),
  ('routing.write','routing.write','مدیریت قواعد مسیریابی'),
  ('dns.read','dns.read','مشاهده تنظیمات DNS'),
  ('dns.write','dns.write','مدیریت تنظیمات DNS'),
  ('chains.read','chains.read','مشاهده زنجیره‌های پروکسی'),
  ('chains.write','chains.write','مدیریت زنجیره‌های پروکسی'),
  ('backends.read','backends.read','مشاهده بک‌اندها'),
  ('backends.write','backends.write','مدیریت بک‌اندها'),
  ('cloudflare.read','cloudflare.read','مشاهده منابع Cloudflare'),
  ('cloudflare.manage','cloudflare.manage','مدیریت منابع Cloudflare'),
  ('telegram.manage','telegram.manage','مدیریت ربات تلگرام'),
  ('analytics.read','analytics.read','مشاهده تحلیل‌ها'),
  ('audit.read','audit.read','مشاهده گزارش رویدادها'),
  ('backup.manage','backup.manage','مدیریت پشتیبان‌گیری'),
  ('settings.read','settings.read','مشاهده تنظیمات'),
  ('settings.write','settings.write','تغییر تنظیمات'),
  ('admins.manage','admins.manage','مدیریت مدیران');

-- مدیر ارشد: همهٔ مجوزها
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'super_admin', id FROM permissions;

-- مدیر: همه به‌جز مدیریت مدیران
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'admin', id FROM permissions WHERE key <> 'admins.manage';

-- فقط خواندنی: مجوزهای read
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'read_only', id FROM permissions WHERE key LIKE '%.read';

-- تنظیمات پیش‌فرض
INSERT INTO system_settings (key, value, is_secret) VALUES
  ('panelName', '"پنل افرا"', 0),
  ('language', '"fa"', 0),
  ('timezone', '"Asia/Tehran"', 0),
  ('theme', '"system"', 0),
  ('calendar', '"jalali"', 0),
  ('edgeUrl', '""', 0),
  ('sessionTtlMinutes', '720', 0),
  ('loginRateLimit', '5', 0),
  ('apiRateLimit', '600', 0),
  ('healthCheckIntervalMinutes', '5', 0),
  ('healthCheckTimeoutMs', '5000', 0),
  ('degradedLatencyMs', '900', 0),
  ('balanceStrategy', '"latency"', 0),
  ('failoverEnabled', 'true', 0),
  ('nodeNameTemplate', '"{FLAG} {COUNTRY} {CITY} {NAME}"', 0),
  ('defaultSubscriptionFormat', '"auto"', 0),
  ('subscriptionUpdateHours', '12', 0),
  ('revokeOnExpire', 'false', 0),
  ('enableIpv6', 'false', 0),
  ('quotaWarningPercent', '85', 0),
  ('expiryWarningDays', '3', 0),
  ('logLevel', '"INFO"', 0),
  ('logRetentionDays', '14', 0),
  ('trafficLoggingEnabled', 'true', 0),
  ('maintenanceMode', 'false', 0),
  ('setupCompleted', 'false', 0),
  ('telegramEnabled', 'false', 0),
  ('telegramNotifyEvents', '["node.down","node.recovered","user.expired","quota.warning","security.event"]', 0);

-- DNS پیش‌فرض (قابل تغییر توسط مدیر)
INSERT INTO dns_servers (id, name, kind, address, is_primary, is_fallback, enabled, supports_ipv6) VALUES
  ('dns-cf-doh', 'Cloudflare DoH', 'doh', 'https://1.1.1.1/dns-query', 1, 0, 1, 1),
  ('dns-google-doh', 'Google DoH', 'doh', 'https://dns.google/dns-query', 0, 1, 1, 1);

-- قواعد مسیریابی پیش‌فرض
INSERT INTO routing_rules (id, name, type, pattern, action, priority, enabled) VALUES
  ('rule-private', 'شبکهٔ محلی', 'cidr', '192.168.0.0/16', 'direct', 10, 1),
  ('rule-loopback', 'لوپ‌بک', 'cidr', '127.0.0.0/8', 'direct', 11, 1),
  ('rule-ir-domains', 'دامنه‌های ir', 'domain-suffix', 'ir', 'direct', 20, 1);
