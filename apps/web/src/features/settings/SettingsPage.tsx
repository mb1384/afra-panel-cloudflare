import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { applyTheme } from '../../lib/theme';
import {
  Badge,
  Button,
  CopyField,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  SectionCard,
  Select,
  Toggle,
} from '../../components/ui';

interface SettingsPayload {
  settings: Record<string, unknown>;
  environment: string;
  version: string;
  capabilities: {
    r2Backups: boolean;
    queues: boolean;
    staticAssets: boolean;
    cloudflareEnv: boolean;
    telegramEnv: boolean;
  };
}

export function SettingsPage(): JSX.Element {
  const { me, can, refresh } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [totpOpen, setTotpOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsPayload>('/settings'),
  });

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<{
        items: { id: string; ip: string | null; userAgent: string | null; createdAt: string; current: boolean }[];
      }>('/auth/sessions'),
  });

  const admins = useQuery({
    queryKey: ['admins'],
    queryFn: () =>
      api.get<{
        items: {
          id: string;
          username: string;
          role: string;
          roleLabelFa: string;
          enabled: boolean;
          totpEnabled: boolean;
          lastLoginAt: string | null;
        }[];
      }>('/settings/admins'),
    enabled: can('admins.manage'),
  });

  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/settings', patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await refresh();
      toast.success('تنظیمات ذخیره شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(`${data.revoked} نشست دیگر باطل شد.`);
    },
  });

  const removeAdmin = useMutation({
    mutationFn: (id: string) => api.del(`/settings/admins/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admins'] });
      toast.success('مدیر حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  if (query.isLoading) return <LoadingState />;

  const value = <T,>(key: string, fallback: T): T => (form[key] as T) ?? fallback;
  const set = (key: string, next: unknown): void => setForm((current) => ({ ...current, [key]: next }));
  const canWrite = can('settings.write');

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="عمومی"
        actions={
          canWrite ? (
            <Button
              icon={<Save className="h-4 w-4" />}
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  panelName: value('panelName', 'پنل افرا'),
                  timezone: value('timezone', 'Asia/Tehran'),
                  theme: value('theme', 'system'),
                  calendar: value('calendar', 'jalali'),
                  edgeUrl: value('edgeUrl', ''),
                })
              }
            >
              ذخیره
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="نام پنل">
            <Input
              disabled={!canWrite}
              value={value('panelName', '')}
              onChange={(event) => set('panelName', event.target.value)}
            />
          </Field>
          <Field label="منطقهٔ زمانی">
            <Input
              ltr
              disabled={!canWrite}
              value={value('timezone', '')}
              onChange={(event) => set('timezone', event.target.value)}
            />
          </Field>
          <Field label="تقویم">
            <Select
              disabled={!canWrite}
              value={value('calendar', 'jalali')}
              onChange={(event) => set('calendar', event.target.value)}
            >
              <option value="jalali">شمسی (جلالی)</option>
              <option value="gregorian">میلادی</option>
            </Select>
          </Field>
          <Field label="پوستهٔ پیش‌فرض">
            <Select
              disabled={!canWrite}
              value={value('theme', 'system')}
              onChange={(event) => {
                set('theme', event.target.value);
                applyTheme(event.target.value as 'light' | 'dark' | 'system');
              }}
            >
              <option value="system">سیستم</option>
              <option value="light">روشن</option>
              <option value="dark">تیره</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="آدرس Worker لبه" hint="لینک‌های اشتراک از این دامنه ساخته می‌شوند">
              <Input
                ltr
                disabled={!canWrite}
                value={value('edgeUrl', '')}
                onChange={(event) => set('edgeUrl', event.target.value)}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="سرورها و توازن بار"
        actions={
          canWrite ? (
            <Button
              icon={<Save className="h-4 w-4" />}
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  healthCheckIntervalMinutes: Number(value('healthCheckIntervalMinutes', 5)),
                  healthCheckTimeoutMs: Number(value('healthCheckTimeoutMs', 5000)),
                  degradedLatencyMs: Number(value('degradedLatencyMs', 900)),
                  balanceStrategy: value('balanceStrategy', 'latency'),
                  failoverEnabled: value('failoverEnabled', true),
                  nodeNameTemplate: value('nodeNameTemplate', '{FLAG} {COUNTRY} {CITY} {NAME}'),
                })
              }
            >
              ذخیره
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="فاصلهٔ بررسی سلامت (دقیقه)" hint="زمان‌بندی واقعی با Cron Trigger هر ۵ دقیقه اجرا می‌شود">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('healthCheckIntervalMinutes', 5))}
              onChange={(event) => set('healthCheckIntervalMinutes', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="مهلت بررسی (میلی‌ثانیه)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('healthCheckTimeoutMs', 5000))}
              onChange={(event) => set('healthCheckTimeoutMs', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="آستانهٔ وضعیت «کند» (میلی‌ثانیه)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('degradedLatencyMs', 900))}
              onChange={(event) => set('degradedLatencyMs', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="استراتژی توازن بار">
            <Select
              disabled={!canWrite}
              value={value('balanceStrategy', 'latency')}
              onChange={(event) => set('balanceStrategy', event.target.value)}
            >
              <option value="latency">کم‌ترین تأخیر</option>
              <option value="priority">اولویت</option>
              <option value="weight">وزنی</option>
              <option value="health">سلامت‌محور</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="قالب نام سرور"
              hint="متغیرها: {FLAG} {COUNTRY} {CITY} {NAME} {PROTOCOL} {INDEX} {DATE}"
            >
              <Input
                ltr
                disabled={!canWrite}
                value={value('nodeNameTemplate', '')}
                onChange={(event) => set('nodeNameTemplate', event.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Toggle
              checked={value('failoverEnabled', true)}
              onChange={(next) => canWrite && set('failoverEnabled', next)}
              label="failover خودکار"
              description="در صورت خرابی سرور، ترتیب اشتراک به سرور سالم بعدی منتقل می‌شود."
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="اشتراک، امنیت و لاگ"
        actions={
          canWrite ? (
            <Button
              icon={<Save className="h-4 w-4" />}
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  defaultSubscriptionFormat: value('defaultSubscriptionFormat', 'auto'),
                  subscriptionUpdateHours: Number(value('subscriptionUpdateHours', 12)),
                  revokeOnExpire: value('revokeOnExpire', false),
                  enableIpv6: value('enableIpv6', false),
                  sessionTtlMinutes: Number(value('sessionTtlMinutes', 720)),
                  loginRateLimit: Number(value('loginRateLimit', 5)),
                  quotaWarningPercent: Number(value('quotaWarningPercent', 85)),
                  expiryWarningDays: Number(value('expiryWarningDays', 3)),
                  logLevel: value('logLevel', 'INFO'),
                  logRetentionDays: Number(value('logRetentionDays', 14)),
                  trafficLoggingEnabled: value('trafficLoggingEnabled', true),
                  maintenanceMode: value('maintenanceMode', false),
                })
              }
            >
              ذخیره
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="فرمت پیش‌فرض اشتراک">
            <Select
              disabled={!canWrite}
              value={value('defaultSubscriptionFormat', 'auto')}
              onChange={(event) => set('defaultSubscriptionFormat', event.target.value)}
            >
              <option value="auto">خودکار</option>
              <option value="base64">Base64</option>
              <option value="clash">Clash</option>
            </Select>
          </Field>
          <Field label="فاصلهٔ به‌روزرسانی اشتراک (ساعت)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('subscriptionUpdateHours', 12))}
              onChange={(event) => set('subscriptionUpdateHours', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="مدت اعتبار نشست (دقیقه)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('sessionTtlMinutes', 720))}
              onChange={(event) => set('sessionTtlMinutes', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="حداکثر تلاش ناموفق ورود">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('loginRateLimit', 5))}
              onChange={(event) => set('loginRateLimit', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="آستانهٔ هشدار حجم (٪)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('quotaWarningPercent', 85))}
              onChange={(event) => set('quotaWarningPercent', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="هشدار انقضا (روز قبل)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('expiryWarningDays', 3))}
              onChange={(event) => set('expiryWarningDays', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="سطح لاگ">
            <Select
              disabled={!canWrite}
              value={value('logLevel', 'INFO')}
              onChange={(event) => set('logLevel', event.target.value)}
            >
              {['DEBUG', 'INFO', 'WARN', 'ERROR'].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="نگهداشت لاگ (روز)">
            <Input
              ltr
              disabled={!canWrite}
              value={String(value('logRetentionDays', 14))}
              onChange={(event) => set('logRetentionDays', event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Toggle
              checked={value('revokeOnExpire', false)}
              onChange={(next) => canWrite && set('revokeOnExpire', next)}
              label="لغو اشتراک هنگام انقضا"
            />
            <Toggle
              checked={value('enableIpv6', false)}
              onChange={(next) => canWrite && set('enableIpv6', next)}
              label="فعال‌سازی IPv6 در کانفیگ کلاینت"
            />
            <Toggle
              checked={value('trafficLoggingEnabled', true)}
              onChange={(next) => canWrite && set('trafficLoggingEnabled', next)}
              label="ثبت متادیتای ترافیک"
              description="فقط حجم مصرفی ثبت می‌شود؛ محتوای ترافیک هرگز بازرسی نمی‌شود."
            />
            <Toggle
              checked={value('maintenanceMode', false)}
              onChange={(next) => canWrite && set('maintenanceMode', next)}
              label="حالت تعمیرات"
              description="در این حالت فقط مدیر ارشد می‌تواند تغییرات ایجاد کند."
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="امنیت حساب من">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={me?.admin.totpEnabled ? 'green' : 'amber'}>
              ورود دومرحله‌ای: {me?.admin.totpEnabled ? 'فعال' : 'غیرفعال'}
            </Badge>
            <Badge tone="gray">نقش: {me?.admin.roleLabelFa}</Badge>
            <Badge tone="blue">
              آخرین ورود: {formatDate(me?.admin.lastLoginAt ?? null, calendar, true)}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<KeyRound className="h-4 w-4" />}
              onClick={() => setPasswordOpen(true)}
            >
              تغییر گذرواژه
            </Button>
            <Button
              variant="secondary"
              icon={<ShieldCheck className="h-4 w-4" />}
              onClick={() => setTotpOpen(true)}
            >
              {me?.admin.totpEnabled ? 'مدیریت ورود دومرحله‌ای' : 'فعال‌سازی ورود دومرحله‌ای'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => revokeOthers.mutate()}
              loading={revokeOthers.isPending}
            >
              خروج از سایر دستگاه‌ها
            </Button>
          </div>

          {sessions.data && sessions.data.items.length > 0 && (
            <ul className="flex flex-col divide-y divide-ink-200 text-xs dark:divide-ink-800">
              {sessions.data.items.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="ltr truncate text-ink-700 dark:text-ink-200">
                      {session.ip ?? 'IP نامشخص'}
                    </p>
                    <p className="ltr truncate text-[11px] text-ink-500">
                      {session.userAgent ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.current && <Badge tone="green">این دستگاه</Badge>}
                    <span className="text-[11px] text-ink-500">
                      {formatDate(session.createdAt, calendar, true)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      {can('admins.manage') && (
        <SectionCard
          title="مدیران پنل"
          actions={
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdminOpen(true)}>
              مدیر جدید
            </Button>
          }
        >
          {admins.isLoading ? (
            <LoadingState />
          ) : (admins.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="مدیری یافت نشد" />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {admins.data?.items.map((admin) => (
                <li key={admin.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="ltr truncate text-sm text-ink-900 dark:text-ink-50">
                      {admin.username}
                    </p>
                    <p className="text-[11px] text-ink-500">
                      آخرین ورود: {formatDate(admin.lastLoginAt, calendar, true)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={admin.role === 'super_admin' ? 'green' : 'gray'}>
                      {admin.roleLabelFa}
                    </Badge>
                    {admin.totpEnabled && <Badge tone="blue">۲FA</Badge>}
                    {admin.id !== me?.admin.id && (
                      <Button
                        variant="ghost"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => removeAdmin.mutate(admin.id)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard title="وضعیت زیرساخت" description="قابلیت‌های در دسترس در این استقرار">
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">D1 (دیتابیس)</Badge>
          <Badge tone="green">KV (کش نشست و تنظیمات)</Badge>
          <Badge tone="green">Durable Objects (نرخ و سلامت)</Badge>
          <Badge tone={query.data?.capabilities.r2Backups ? 'green' : 'amber'}>
            R2 (پشتیبان): {query.data?.capabilities.r2Backups ? 'فعال' : 'غیرفعال'}
          </Badge>
          <Badge tone={query.data?.capabilities.queues ? 'green' : 'gray'}>
            Queues: {query.data?.capabilities.queues ? 'فعال' : 'استفاده نشده'}
          </Badge>
          <Badge tone={query.data?.capabilities.cloudflareEnv ? 'green' : 'amber'}>
            اعتبارنامهٔ Cloudflare در محیط
          </Badge>
          <Badge tone="gray">محیط: {query.data?.environment}</Badge>
          <Badge tone="gray">نسخهٔ {query.data?.version}</Badge>
        </div>
      </SectionCard>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <TotpModal open={totpOpen} onClose={() => setTotpOpen(false)} enabled={me?.admin.totpEnabled ?? false} />
      <AdminModal open={adminOpen} onClose={() => setAdminOpen(false)} />
    </div>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('گذرواژه تغییر کرد. سایر نشست‌ها باطل شدند.');
      setCurrentPassword('');
      setNewPassword('');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'تغییر گذرواژه ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="تغییر گذرواژه"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => change.mutate()} loading={change.isPending}>
            تغییر گذرواژه
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="گذرواژهٔ فعلی" required>
          <Input
            ltr
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="گذرواژهٔ جدید" hint="حداقل ۱۲ نویسه شامل حرف بزرگ، کوچک و رقم" required>
          <Input
            ltr
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function TotpModal({
  open,
  onClose,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
}): JSX.Element {
  const toast = useToast();
  const { refresh } = useAuth();
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const setup = useMutation({
    mutationFn: () => api.post<{ secret: string; uri: string }>('/auth/totp/setup'),
    onSuccess: (data) => {
      setSecret(data.secret);
      setUri(data.uri);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'آماده‌سازی ناموفق بود.'),
  });

  const enable = useMutation({
    mutationFn: () => api.post('/auth/totp/enable', { code }),
    onSuccess: async () => {
      await refresh();
      toast.success('ورود دومرحله‌ای فعال شد.');
      setCode('');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'کد نادرست است.'),
  });

  const disable = useMutation({
    mutationFn: () => api.post('/auth/totp/disable', { code }),
    onSuccess: async () => {
      await refresh();
      toast.success('ورود دومرحله‌ای غیرفعال شد.');
      setCode('');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'کد نادرست است.'),
  });

  return (
    <Modal
      open={open}
      title="ورود دومرحله‌ای"
      onClose={onClose}
      footer={
        enabled ? (
          <Button variant="danger" onClick={() => disable.mutate()} loading={disable.isPending}>
            غیرفعال‌سازی
          </Button>
        ) : secret ? (
          <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length !== 6}>
            تأیید و فعال‌سازی
          </Button>
        ) : (
          <Button onClick={() => setup.mutate()} loading={setup.isPending}>
            شروع
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {enabled ? (
          <>
            <p className="text-sm text-ink-700 dark:text-ink-200">
              برای غیرفعال‌سازی، کد فعلی برنامهٔ احراز هویت را وارد کنید.
            </p>
            <Field label="کد ۶ رقمی" required>
              <Input
                ltr
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        ) : secret ? (
          <>
            <p className="text-sm leading-6 text-ink-700 dark:text-ink-200">
              این کلید را در برنامهٔ احراز هویت (مانند Aegis یا Google Authenticator) وارد کنید، سپس
              کد ۶ رقمی را برای تأیید بنویسید.
            </p>
            <CopyField value={secret} label="کلید مخفی" />
            {uri && <CopyField value={uri} label="نشانی otpauth" />}
            <Field label="کد ۶ رقمی" required>
              <Input
                ltr
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        ) : (
          <p className="text-sm leading-6 text-ink-700 dark:text-ink-200">
            با فعال‌سازی ورود دومرحله‌ای، علاوه بر گذرواژه یک کد یک‌بارمصرف نیز لازم خواهد بود.
          </p>
        )}
      </div>
    </Modal>
  );
}

function AdminModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ username: '', email: '', password: '', role: 'admin' });

  const create = useMutation({
    mutationFn: () =>
      api.post('/settings/admins', {
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        role: values.role,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admins'] });
      toast.success('مدیر جدید ایجاد شد.');
      setValues({ username: '', email: '', password: '', role: 'admin' });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ایجاد مدیر ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="ایجاد مدیر جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            ایجاد
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام کاربری" required>
          <Input
            ltr
            value={values.username}
            onChange={(event) => setValues({ ...values, username: event.target.value })}
          />
        </Field>
        <Field label="ایمیل">
          <Input
            ltr
            type="email"
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />
        </Field>
        <Field label="گذرواژه" hint="حداقل ۱۲ نویسه" required>
          <Input
            ltr
            type="password"
            value={values.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />
        </Field>
        <Field label="نقش">
          <Select value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value })}>
            <option value="admin">مدیر</option>
            <option value="read_only">فقط خواندنی</option>
            <option value="super_admin">مدیر ارشد</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
