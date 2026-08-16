import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, toPersianDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  NodeHealthIndicator,
  SectionCard,
  Select,
  Toggle,
} from '../../components/ui';

interface Backend {
  id: string;
  name: string;
  url: string;
  authType: string;
  enabled: boolean;
  isFallback: boolean;
  health: string;
  latencyMs: number | null;
  lastCheckAt: string | null;
  hasSecret: boolean;
}

interface WarpConfig {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  routeMode: string;
  health: string;
  latencyMs: number | null;
  lastCheckAt: string | null;
}

const ROUTE_MODES: Record<string, string> = {
  off: 'خاموش',
  selected: 'ترافیک انتخابی',
  all: 'همهٔ ترافیک',
};

export function BackendsPage(): JSX.Element {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [backendModal, setBackendModal] = useState(false);
  const [warpModal, setWarpModal] = useState(false);

  const backends = useQuery({
    queryKey: ['backends'],
    queryFn: () => api.get<{ items: Backend[] }>('/backends'),
  });

  const warp = useQuery({
    queryKey: ['warp'],
    queryFn: () => api.get<{ items: WarpConfig[] }>('/warp'),
  });

  const checkBackends = useMutation({
    mutationFn: () => api.post<{ checked: number }>('/backends/check'),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['backends'] });
      toast.success(`${toPersianDigits(data.checked)} بک‌اند بررسی شد.`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بررسی ناموفق بود.'),
  });

  const checkWarp = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/warp/${id}/check`),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['warp'] });
      toast[data.ok ? 'success' : 'error'](
        data.ok ? 'endpoint در دسترس است.' : 'endpoint پاسخ نداد.',
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بررسی ناموفق بود.'),
  });

  const removeBackend = useMutation({
    mutationFn: (id: string) => api.del(`/backends/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backends'] });
      toast.success('بک‌اند حذف شد.');
    },
  });

  const removeWarp = useMutation({
    mutationFn: (id: string) => api.del(`/warp/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['warp'] });
      toast.success('پیکربندی WARP حذف شد.');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="بک‌اندها"
        description="بک‌اند اختیاری روی سرور شما؛ اسرار رمزنگاری‌شده ذخیره و هرگز بازگردانده نمی‌شوند."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Activity className="h-4 w-4" />}
              onClick={() => checkBackends.mutate()}
              loading={checkBackends.isPending}
            >
              بررسی سلامت
            </Button>
            {can('backends.write') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setBackendModal(true)}>
                بک‌اند جدید
              </Button>
            )}
          </>
        }
      >
        {backends.isLoading ? (
          <LoadingState />
        ) : (backends.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="بک‌اندی ثبت نشده است" description="این بخش اختیاری است." />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {backends.data?.items.map((backend) => (
              <li key={backend.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                    {backend.name}
                  </p>
                  <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">{backend.url}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="gray">{backend.authType}</Badge>
                  {backend.hasSecret && <Badge tone="green">راز ذخیره‌شده</Badge>}
                  {backend.isFallback && <Badge tone="blue">پشتیبان</Badge>}
                  <NodeHealthIndicator health={backend.health} latencyMs={backend.latencyMs} />
                  <span className="text-[11px] text-ink-500">
                    {formatDate(backend.lastCheckAt, calendar, true)}
                  </span>
                  {can('backends.write') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => removeBackend.mutate(backend.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="WARP (اختیاری)"
        description="مسیر انتقال اختیاری. تا زمانی که فعال نشود هیچ تأثیری بر ترافیک ندارد."
        actions={
          can('backends.write') ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWarpModal(true)}>
              پیکربندی WARP
            </Button>
          ) : undefined
        }
      >
        {warp.isLoading ? (
          <LoadingState />
        ) : (warp.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="پیکربندی WARP وجود ندارد" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {warp.data?.items.map((config) => (
              <li key={config.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                    {config.name}
                  </p>
                  <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                    {config.endpoint}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={config.enabled ? 'green' : 'gray'}>
                    {config.enabled ? 'فعال' : 'غیرفعال'}
                  </Badge>
                  <Badge tone="gray">{ROUTE_MODES[config.routeMode] ?? config.routeMode}</Badge>
                  <NodeHealthIndicator health={config.health} latencyMs={config.latencyMs} />
                  <Button
                    variant="secondary"
                    icon={<Activity className="h-4 w-4" />}
                    onClick={() => checkWarp.mutate(config.id)}
                    loading={checkWarp.isPending && checkWarp.variables === config.id}
                  >
                    بررسی
                  </Button>
                  {can('backends.write') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => removeWarp.mutate(config.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <BackendModal open={backendModal} onClose={() => setBackendModal(false)} />
      <WarpModal open={warpModal} onClose={() => setWarpModal(false)} />
    </div>
  );
}

function BackendModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    name: '',
    url: '',
    authType: 'bearer',
    secret: '',
    isFallback: false,
    enabled: true,
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/backends', {
        name: values.name.trim(),
        url: values.url.trim(),
        authType: values.authType,
        secret: values.secret || null,
        isFallback: values.isFallback,
        enabled: values.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backends'] });
      toast.success('بک‌اند افزوده شد.');
      setValues({ name: '', url: '', authType: 'bearer', secret: '', isFallback: false, enabled: true });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="افزودن بک‌اند"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            افزودن
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام" required>
          <Input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </Field>
        <Field label="آدرس" hint="مثال: https://backend.example.com" required>
          <Input ltr value={values.url} onChange={(event) => setValues({ ...values, url: event.target.value })} />
        </Field>
        <Field label="نوع احراز هویت">
          <Select
            value={values.authType}
            onChange={(event) => setValues({ ...values, authType: event.target.value })}
          >
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic</option>
            <option value="none">بدون احراز هویت</option>
          </Select>
        </Field>
        {values.authType !== 'none' && (
          <Field label="راز / توکن" hint="رمزنگاری‌شده ذخیره می‌شود و هرگز نمایش داده نمی‌شود">
            <Input
              ltr
              type="password"
              value={values.secret}
              onChange={(event) => setValues({ ...values, secret: event.target.value })}
            />
          </Field>
        )}
        <Toggle
          checked={values.isFallback}
          onChange={(value) => setValues({ ...values, isFallback: value })}
          label="استفاده به‌عنوان بک‌اند پشتیبان"
        />
      </div>
    </Modal>
  );
}

function WarpModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    name: 'WARP',
    endpoint: 'engage.cloudflareclient.com:2408',
    routeMode: 'off',
    enabled: false,
  });

  const save = useMutation({
    mutationFn: () => api.post('/warp', { ...values, name: values.name.trim(), endpoint: values.endpoint.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['warp'] });
      toast.success('پیکربندی WARP ذخیره شد.');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="پیکربندی WARP"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام" required>
          <Input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </Field>
        <Field label="endpoint" hint="میزبان:پورت">
          <Input
            ltr
            value={values.endpoint}
            onChange={(event) => setValues({ ...values, endpoint: event.target.value })}
          />
        </Field>
        <Field label="حالت مسیریابی">
          <Select
            value={values.routeMode}
            onChange={(event) => setValues({ ...values, routeMode: event.target.value })}
          >
            {Object.entries(ROUTE_MODES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Toggle
          checked={values.enabled}
          onChange={(value) => setValues({ ...values, enabled: value })}
          label="فعال باشد"
          description="WARP اختیاری است و به‌طور پیش‌فرض خاموش می‌ماند."
        />
      </div>
    </Modal>
  );
}
