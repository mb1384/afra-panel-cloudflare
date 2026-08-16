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
  ConfirmDialog,
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

interface DnsServer {
  id: string;
  name: string;
  kind: string;
  address: string;
  uri: string;
  isPrimary: boolean;
  isFallback: boolean;
  enabled: boolean;
  supportsIpv6: boolean;
  health: string;
  latencyMs: number | null;
  lastCheckAt: string | null;
}

interface FilterList {
  id: string;
  name: string;
  kind: string;
  entryCount: number;
  enabled: boolean;
}

const FILTER_LABELS: Record<string, string> = {
  whitelist: 'فهرست سفید',
  blacklist: 'فهرست سیاه',
  ads: 'مسدودسازی تبلیغات',
  trackers: 'مسدودسازی ردیاب‌ها',
  custom: 'سفارشی',
};

export function DnsPage(): JSX.Element {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [serverModal, setServerModal] = useState(false);
  const [filterModal, setFilterModal] = useState(false);
  const [pendingServer, setPendingServer] = useState<DnsServer | null>(null);

  const servers = useQuery({
    queryKey: ['dns-servers'],
    queryFn: () => api.get<{ items: DnsServer[] }>('/dns/servers'),
  });

  const filters = useQuery({
    queryKey: ['dns-filters'],
    queryFn: () => api.get<{ items: FilterList[] }>('/dns/filters'),
  });

  const check = useMutation({
    mutationFn: () => api.post<{ checked: number }>('/dns/servers/check'),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['dns-servers'] });
      toast.success(`${toPersianDigits(data.checked)} سرور DNS بررسی شد.`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بررسی ناموفق بود.'),
  });

  const removeServer = useMutation({
    mutationFn: (id: string) => api.del(`/dns/servers/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-servers'] });
      setPendingServer(null);
      toast.success('سرور DNS حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  const removeFilter = useMutation({
    mutationFn: (id: string) => api.del(`/dns/filters/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-filters'] });
      toast.success('فهرست فیلتر حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="سرورهای DNS"
        description="پشتیبانی از DNS استاندارد، DoH و DoT با بررسی سلامت واقعی"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Activity className="h-4 w-4" />}
              onClick={() => check.mutate()}
              loading={check.isPending}
            >
              بررسی سلامت
            </Button>
            {can('dns.write') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setServerModal(true)}>
                سرور DNS
              </Button>
            )}
          </>
        }
      >
        {servers.isLoading ? (
          <LoadingState />
        ) : (servers.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="سرور DNS ثبت نشده است" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {servers.data?.items.map((server) => (
              <li key={server.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                    {server.name}
                    {server.isPrimary && <Badge tone="green" className="mr-2">اصلی</Badge>}
                    {server.isFallback && <Badge tone="blue" className="mr-2">پشتیبان</Badge>}
                  </p>
                  <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">{server.uri}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="gray">{server.kind.toUpperCase()}</Badge>
                  {server.supportsIpv6 && <Badge tone="gray">IPv6</Badge>}
                  <NodeHealthIndicator health={server.health} latencyMs={server.latencyMs} />
                  <span className="text-[11px] text-ink-500">
                    {formatDate(server.lastCheckAt, calendar, true)}
                  </span>
                  {can('dns.write') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setPendingServer(server)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="فیلترینگ دامنه"
        description="فهرست‌های سفید، سیاه، تبلیغات و ردیاب‌ها — بدون فهرست از پیش تعیین‌شده"
        actions={
          can('dns.write') ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFilterModal(true)}>
              فهرست جدید
            </Button>
          ) : undefined
        }
      >
        {filters.isLoading ? (
          <LoadingState />
        ) : (filters.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="فهرستی ثبت نشده است"
            description="می‌توانید فهرست دامنه‌های خودتان را وارد کنید."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {filters.data?.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{item.name}</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    {FILTER_LABELS[item.kind] ?? item.kind} · {toPersianDigits(item.entryCount)} دامنه
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={item.enabled ? 'green' : 'gray'}>
                    {item.enabled ? 'فعال' : 'غیرفعال'}
                  </Badge>
                  {can('dns.write') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => removeFilter.mutate(item.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <DnsServerModal open={serverModal} onClose={() => setServerModal(false)} />
      <FilterModal open={filterModal} onClose={() => setFilterModal(false)} />

      <ConfirmDialog
        open={Boolean(pendingServer)}
        title="حذف سرور DNS"
        message={`سرور «${pendingServer?.name ?? ''}» حذف شود؟`}
        danger
        confirmLabel="حذف"
        loading={removeServer.isPending}
        onCancel={() => setPendingServer(null)}
        onConfirm={() => pendingServer && removeServer.mutate(pendingServer.id)}
      />
    </div>
  );
}

function DnsServerModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    name: '',
    kind: 'doh',
    address: '',
    isPrimary: false,
    isFallback: false,
    supportsIpv6: false,
    enabled: true,
  });

  const save = useMutation({
    mutationFn: () => api.post('/dns/servers', { ...values, name: values.name.trim(), address: values.address.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-servers'] });
      toast.success('سرور DNS افزوده شد.');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="افزودن سرور DNS"
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
        <Field label="نوع">
          <Select value={values.kind} onChange={(event) => setValues({ ...values, kind: event.target.value })}>
            <option value="doh">DNS over HTTPS</option>
            <option value="dot">DNS over TLS</option>
            <option value="udp">DNS استاندارد (UDP)</option>
          </Select>
        </Field>
        <Field
          label="آدرس"
          hint={values.kind === 'doh' ? 'مثال: https://1.1.1.1/dns-query' : 'مثال: 1.1.1.1 یا tls://1.1.1.1:853'}
          required
        >
          <Input
            ltr
            value={values.address}
            onChange={(event) => setValues({ ...values, address: event.target.value })}
          />
        </Field>
        <Toggle
          checked={values.isPrimary}
          onChange={(value) => setValues({ ...values, isPrimary: value })}
          label="سرور اصلی"
          description="تنها یک سرور می‌تواند اصلی باشد."
        />
        <Toggle
          checked={values.isFallback}
          onChange={(value) => setValues({ ...values, isFallback: value })}
          label="سرور پشتیبان (fallback)"
        />
        <Toggle
          checked={values.supportsIpv6}
          onChange={(value) => setValues({ ...values, supportsIpv6: value })}
          label="پشتیبانی از IPv6"
        />
      </div>
    </Modal>
  );
}

function FilterModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('blacklist');
  const [entries, setEntries] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post<{ entryCount: number }>('/dns/filters', {
        name: name.trim(),
        kind,
        entries: entries
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['dns-filters'] });
      toast.success(`فهرست با ${toPersianDigits(data.entryCount)} دامنه ذخیره شد.`);
      setName('');
      setEntries('');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="فهرست فیلتر جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام فهرست" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="نوع">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            {Object.entries(FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="دامنه‌ها" hint="هر دامنه در یک خط یا با کاما جدا شود">
          <textarea
            dir="ltr"
            rows={8}
            value={entries}
            onChange={(event) => setEntries(event.target.value)}
            className="ltr w-full rounded-xl border border-ink-300 bg-white p-3 font-mono text-xs dark:border-ink-700 dark:bg-ink-950"
          />
        </Field>
      </div>
    </Modal>
  );
}
