import type { RoleName } from './types.js';

export const PERMISSIONS = [
  { key: 'users.read', labelFa: 'مشاهده کاربران' },
  { key: 'users.write', labelFa: 'ایجاد و ویرایش کاربران' },
  { key: 'users.delete', labelFa: 'حذف کاربران' },
  { key: 'subscriptions.read', labelFa: 'مشاهده اشتراک‌ها' },
  { key: 'subscriptions.write', labelFa: 'مدیریت اشتراک‌ها' },
  { key: 'nodes.read', labelFa: 'مشاهده سرورها' },
  { key: 'nodes.write', labelFa: 'ایجاد و ویرایش سرورها' },
  { key: 'nodes.delete', labelFa: 'حذف سرورها' },
  { key: 'routing.read', labelFa: 'مشاهده قواعد مسیریابی' },
  { key: 'routing.write', labelFa: 'مدیریت قواعد مسیریابی' },
  { key: 'dns.read', labelFa: 'مشاهده تنظیمات DNS' },
  { key: 'dns.write', labelFa: 'مدیریت تنظیمات DNS' },
  { key: 'chains.read', labelFa: 'مشاهده زنجیره‌های پروکسی' },
  { key: 'chains.write', labelFa: 'مدیریت زنجیره‌های پروکسی' },
  { key: 'backends.read', labelFa: 'مشاهده بک‌اندها' },
  { key: 'backends.write', labelFa: 'مدیریت بک‌اندها' },
  { key: 'cloudflare.read', labelFa: 'مشاهده منابع Cloudflare' },
  { key: 'cloudflare.manage', labelFa: 'مدیریت منابع Cloudflare' },
  { key: 'telegram.manage', labelFa: 'مدیریت ربات تلگرام' },
  { key: 'analytics.read', labelFa: 'مشاهده تحلیل‌ها' },
  { key: 'audit.read', labelFa: 'مشاهده گزارش رویدادها' },
  { key: 'backup.manage', labelFa: 'مدیریت پشتیبان‌گیری' },
  { key: 'settings.read', labelFa: 'مشاهده تنظیمات' },
  { key: 'settings.write', labelFa: 'تغییر تنظیمات' },
  { key: 'admins.manage', labelFa: 'مدیریت مدیران' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

const READ_ONLY_KEYS: PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (k) => k.endsWith('.read'),
) as PermissionKey[];

export const ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  super_admin: ALL_PERMISSION_KEYS,
  admin: ALL_PERMISSION_KEYS.filter((k) => k !== 'admins.manage') as PermissionKey[],
  read_only: READ_ONLY_KEYS,
};

export const ROLE_LABELS_FA: Record<RoleName, string> = {
  super_admin: 'مدیر ارشد',
  admin: 'مدیر',
  read_only: 'فقط خواندنی',
};

export function roleHasPermission(role: RoleName, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
