import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  CopyField,
  EmptyState,
  Field,
  Input,
  LoadingState,
  SectionCard,
  Select,
  Toggle,
} from '../../components/ui';

interface TelegramSettings {
  enabled: boolean;
  botTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  tokenSource: string | null;
  notifyEvents: string[];
  webhookUrl: string;
}

interface TelegramAdmin {
  id: string;
  telegramId: string;
  label: string | null;
  role: string;
}

const EVENTS: { key: string; label: string }[] = [
  { key: 'node.down', label: 'خرابی سرور' },
  { key: 'node.recovered', label: 'بازیابی سرور' },
  { key: 'node.degraded', label: 'افت کیفیت سرور' },
  { key: 'user.expired', label: 'انقضای کاربر' },
  { key: 'user.expiring', label: 'نزدیک شدن انقضا' },
  { key: 'quota.warning', label: 'هشدار حجم' },
  { key: 'security.event', label: 'رویداد امنیتی' },
];

export function TelegramPage(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [newAdmin, setNewAdmin] = useState({ telegramId: '', label: '', role: 'read_only' });

  const settings = useQuery({
    queryKey: ['telegram-settings'],
    queryFn: () => api.get<TelegramSettings>('/telegram/settings'),
  });

  const admins = useQuery({
    queryKey: ['telegram-admins'],
    queryFn: () => api.get<{ items: TelegramAdmin[] }>('/telegram/admins'),
  });

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setEvents(settings.data.notifyEvents);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/telegram/settings', {
        enabled,
        notifyEvents: events,
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telegram-settings'] });
      setBotToken('');
      setWebhookSecret('');
      toast.success('تنظیمات تلگرام ذخیره شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  const registerWebhook = useMutation({
    mutationFn: () =>
      api.post<{ registered: boolean; message: string | null; webhookUrl: string }>(
        '/telegram/webhook/register',
      ),
    onSuccess: (data) => {
      if (data.registered) toast.success('webhook روی تلگرام ثبت شد.');
      else toast.error(data.message ?? 'ثبت webhook ناموفق بود.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ثبت webhook ناموفق بود.'),
  });

  const addAdmin = useMutation({
    mutationFn: () =>
      api.post('/telegram/admins', {
        telegramId: newAdmin.telegramId.trim(),
        label: newAdmin.label.trim() || null,
        role: newAdmin.role,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telegram-admins'] });
      setNewAdmin({ telegramId: '', label: '', role: 'read_only' });
      toast.success('مدیر تلگرام افزوده شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'افزودن ناموفق بود.'),
  });

  const removeAdmin = useMutation({
    mutationFn: (id: string) => api.del(`/telegram/admins/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telegram-admins'] });
      toast.success('مدیر حذف شد.');
    },
  });

  if (settings.isLoading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="ربات تلگرام"
        description="ربات اختیاری برای مدیریت کاربران و دریافت اعلان‌ها. همهٔ پیام‌ها فارسی هستند."
        actions={
          <Button onClick={() => save.mutate()} loading={save.isPending} icon={<Send className="h-4 w-4" />}>
            ذخیره تنظیمات
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={settings.data?.botTokenConfigured ? 'green' : 'amber'}>
              توکن ربات: {settings.data?.botTokenConfigured ? 'تنظیم شده' : 'تنظیم نشده'}
            </Badge>
            <Badge tone={settings.data?.webhookSecretConfigured ? 'green' : 'amber'}>
              راز webhook: {settings.data?.webhookSecretConfigured ? 'تنظیم شده' : 'تنظیم نشده'}
            </Badge>
            {settings.data?.tokenSource && (
              <Badge tone="blue">
                منبع توکن: {settings.data.tokenSource === 'env' ? 'متغیر محیطی' : 'تنظیمات'}
              </Badge>
            )}
          </div>

          <Toggle checked={enabled} onChange={setEnabled} label="ربات فعال باشد" />

          <Field label="توکن ربات" hint="برای تغییر، مقدار جدید را وارد کنید؛ مقدار فعلی نمایش داده نمی‌شود.">
            <Input
              ltr
              type="password"
              placeholder="123456789:AA..."
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
            />
          </Field>

          <Field label="راز webhook" hint="رشتهٔ تصادفی برای اعتبارسنجی درخواست‌های تلگرام">
            <Input
              ltr
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-700 dark:text-ink-200">رویدادهای اعلان</p>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((event) => {
                const active = events.includes(event.key);
                return (
                  <button
                    key={event.key}
                    type="button"
                    onClick={() =>
                      setEvents((current) =>
                        active ? current.filter((item) => item !== event.key) : [...current, event.key],
                      )
                    }
                    className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                      active
                        ? 'border-afra-500 bg-afra-50 text-afra-800 dark:bg-afra-950 dark:text-afra-200'
                        : 'border-ink-300 text-ink-600 dark:border-ink-700 dark:text-ink-300'
                    }`}
                  >
                    {event.label}
                  </button>
                );
              })}
            </div>
          </div>

          {settings.data?.webhookUrl && (
            <>
              <CopyField value={settings.data.webhookUrl} label="آدرس webhook" />
              <Button
                variant="secondary"
                icon={<Webhook className="h-4 w-4" />}
                onClick={() => registerWebhook.mutate()}
                loading={registerWebhook.isPending}
                disabled={!settings.data.botTokenConfigured || !settings.data.webhookSecretConfigured}
              >
                ثبت webhook روی تلگرام
              </Button>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="مدیران مجاز تلگرام"
        description="فقط شناسه‌های این فهرست می‌توانند دستور اجرا کنند. نقش «فقط خواندنی» اجازهٔ تغییر ندارد."
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="شناسه تلگرام" required>
              <Input
                ltr
                inputMode="numeric"
                value={newAdmin.telegramId}
                onChange={(event) =>
                  setNewAdmin({ ...newAdmin, telegramId: event.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label="برچسب">
              <Input
                value={newAdmin.label}
                onChange={(event) => setNewAdmin({ ...newAdmin, label: event.target.value })}
              />
            </Field>
            <Field label="نقش">
              <Select
                value={newAdmin.role}
                onChange={(event) => setNewAdmin({ ...newAdmin, role: event.target.value })}
              >
                <option value="read_only">فقط خواندنی</option>
                <option value="admin">مدیر</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                block
                icon={<Plus className="h-4 w-4" />}
                onClick={() => addAdmin.mutate()}
                loading={addAdmin.isPending}
                disabled={newAdmin.telegramId.length < 5}
              >
                افزودن
              </Button>
            </div>
          </div>

          {admins.isLoading ? (
            <LoadingState />
          ) : (admins.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="مدیری ثبت نشده است"
              description="تا زمانی که شناسه‌ای اضافه نشود، ربات به هیچ‌کس پاسخ نمی‌دهد."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {admins.data?.items.map((admin) => (
                <li key={admin.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="ltr truncate text-sm text-ink-900 dark:text-ink-50">
                      {admin.telegramId}
                    </p>
                    {admin.label && (
                      <p className="truncate text-xs text-ink-500 dark:text-ink-400">{admin.label}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={admin.role === 'admin' ? 'green' : 'gray'}>
                      {admin.role === 'admin' ? 'مدیر' : 'فقط خواندنی'}
                    </Badge>
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => removeAdmin.mutate(admin.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
