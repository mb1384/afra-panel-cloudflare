import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Rocket, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
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
  SectionCard,
  Select,
} from '../../components/ui';

interface CloudflareStatus {
  configured: boolean;
  healthy: boolean;
  accountId: string | null;
  source: string | null;
  tokenStatus?: string;
  workersSubdomain?: string | null;
  scriptVersion?: string;
  message?: string;
}

interface Resources {
  workers: { name: string; modifiedOn: string | null }[];
  kvNamespaces: { id: string; title: string }[];
  d1Databases: { id: string; name: string }[];
  r2Buckets: { name: string }[];
}

interface EndpointRecord {
  id: string;
  kind: string;
  cfId: string | null;
  name: string;
  nodeId: string | null;
  metadata: { hostname?: string; d1Bound?: boolean } | null;
  createdAt: string;
}

export function CloudflarePage(): JSX.Element {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [deployOpen, setDeployOpen] = useState(false);
  const [credsOpen, setCredsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EndpointRecord | null>(null);

  const status = useQuery({
    queryKey: ['cf-status'],
    queryFn: () => api.get<CloudflareStatus>('/cloudflare/status'),
  });

  const resources = useQuery({
    queryKey: ['cf-resources'],
    queryFn: () => api.get<Resources>('/cloudflare/resources'),
    enabled: status.data?.configured === true && status.data?.healthy === true,
    retry: false,
  });

  const endpoints = useQuery({
    queryKey: ['cf-endpoints'],
    queryFn: () => api.get<{ items: EndpointRecord[] }>('/cloudflare/endpoints'),
  });

  const syncUsers = useMutation({
    mutationFn: () => api.post<{ synced: number }>('/cloudflare/sync-users'),
    onSuccess: (data) => toast.success(`${data.synced} کاربر با کش لبه هم‌گام شد.`),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'هم‌گام‌سازی ناموفق بود.'),
  });

  const removeEndpoint = useMutation({
    mutationFn: (name: string) => api.del(`/cloudflare/endpoints/${encodeURIComponent(name)}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cf-endpoints'] });
      setPendingDelete(null);
      toast.success('Worker حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  if (status.isLoading) return <LoadingState label="در حال بررسی اتصال Cloudflare…" />;

  const data = status.data;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="اتصال Cloudflare"
        description="کل زیرساخت افرا روی Cloudflare اجرا می‌شود: Workers، D1، KV، R2 و Durable Objects."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void status.refetch()}
            >
              بررسی دوباره
            </Button>
            {can('cloudflare.manage') && (
              <Button variant="secondary" onClick={() => setCredsOpen(true)}>
                تنظیم اعتبارنامه
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone={data?.configured ? 'green' : 'red'}>
              {data?.configured ? 'پیکربندی‌شده' : 'پیکربندی‌نشده'}
            </Badge>
            <Badge tone={data?.healthy ? 'green' : 'amber'}>
              توکن: {data?.tokenStatus ?? (data?.healthy ? 'فعال' : 'نامشخص')}
            </Badge>
            {data?.source && <Badge tone="blue">منبع: {data.source === 'env' ? 'متغیر محیطی' : 'تنظیمات'}</Badge>}
            {data?.accountId && (
              <Badge tone="gray">
                <span className="ltr">{data.accountId.slice(0, 8)}…</span>
              </Badge>
            )}
            {data?.workersSubdomain && (
              <Badge tone="gray">
                <span className="ltr">{data.workersSubdomain}.workers.dev</span>
              </Badge>
            )}
          </div>

          {!data?.configured && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              برای مدیریت خودکار endpointها، توکن Cloudflare را با دستور
              <code className="ltr mx-1">wrangler secret put CLOUDFLARE_API_TOKEN</code>
              و شناسهٔ حساب را با
              <code className="ltr mx-1">CLOUDFLARE_ACCOUNT_ID</code>
              تنظیم کنید (روش امن‌تر)، یا از دکمهٔ «تنظیم اعتبارنامه» استفاده نمایید. توکن باید scoped
              باشد و هرگز در فرانت‌اند ذخیره نمی‌شود.
            </p>
          )}

          {data?.configured && !data.healthy && data.message && (
            <p className="rounded-xl bg-red-50 p-3 text-xs leading-6 text-red-700 dark:bg-red-950 dark:text-red-300">
              {data.message}
            </p>
          )}
        </div>
      </SectionCard>

      {data?.healthy && (
        <SectionCard
          title="منابع حساب Cloudflare"
          description="فهرست واقعی منابع حساب شما از طریق Cloudflare API"
        >
          {resources.isLoading ? (
            <LoadingState />
          ) : resources.error ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              دریافت منابع ناموفق بود؛ مجوزهای توکن را بررسی کنید.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ResourceList title="Workers" items={resources.data?.workers.map((item) => item.name) ?? []} />
              <ResourceList title="D1" items={resources.data?.d1Databases.map((item) => item.name) ?? []} />
              <ResourceList title="KV" items={resources.data?.kvNamespaces.map((item) => item.title) ?? []} />
              <ResourceList title="R2" items={resources.data?.r2Buckets.map((item) => item.name) ?? []} />
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="endpointهای مدیریت‌شده"
        description="Workerهایی که افرا برای شما منتشر کرده است"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Users className="h-4 w-4" />}
              onClick={() => syncUsers.mutate()}
              loading={syncUsers.isPending}
              disabled={!can('cloudflare.manage')}
            >
              هم‌گام‌سازی کاربران
            </Button>
            {can('cloudflare.manage') && (
              <Button
                icon={<Rocket className="h-4 w-4" />}
                onClick={() => setDeployOpen(true)}
                disabled={!data?.healthy}
                title={data?.healthy ? undefined : 'ابتدا اتصال Cloudflare را تنظیم کنید'}
              >
                انتشار endpoint
              </Button>
            )}
          </>
        }
      >
        {endpoints.isLoading ? (
          <LoadingState />
        ) : (endpoints.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="هنوز endpointی منتشر نشده است"
            description="با انتشار endpoint، یک Worker واقعی روی حساب Cloudflare شما ساخته می‌شود که به همان D1 و KV پنل متصل است."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {endpoints.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="ltr truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                    {item.name}
                  </p>
                  <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                    {item.metadata?.hostname ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="gray">{item.kind}</Badge>
                  {item.metadata?.d1Bound && <Badge tone="green">D1 متصل</Badge>}
                  <span className="text-[11px] text-ink-500 dark:text-ink-400">
                    {formatDate(item.createdAt, calendar)}
                  </span>
                  {item.kind === 'worker' && can('cloudflare.manage') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setPendingDelete(item)}
                    >
                      حذف
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <DeployModal open={deployOpen} onClose={() => setDeployOpen(false)} />
      <CredentialsModal open={credsOpen} onClose={() => setCredsOpen(false)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف Worker"
        message={`Worker «${pendingDelete?.name ?? ''}» از حساب Cloudflare شما حذف می‌شود و کاربران متصل به آن قطع می‌شوند.`}
        confirmLabel="حذف Worker"
        danger
        loading={removeEndpoint.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removeEndpoint.mutate(pendingDelete.name)}
      />
    </div>
  );
}

function ResourceList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
      <p className="mb-2 text-xs font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-ink-500">موردی یافت نشد.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, 6).map((item) => (
            <li key={item} className="ltr truncate text-[11px] text-ink-600 dark:text-ink-300">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeployModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [nodeId, setNodeId] = useState('');
  const [scriptName, setScriptName] = useState('afra-endpoint-1');
  const [zoneId, setZoneId] = useState('');
  const [routeHost, setRouteHost] = useState('');

  const nodes = useQuery({
    queryKey: ['nodes', 'cf-deploy'],
    queryFn: () =>
      api.get<{ items: { id: string; name: string; kind: string; protocol: string }[] }>(
        '/nodes?pageSize=100&kind=cloudflare-edge',
      ),
    enabled: open,
  });

  const zones = useQuery({
    queryKey: ['cf-zones'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/cloudflare/zones'),
    enabled: open,
    retry: false,
  });

  const deploy = useMutation({
    mutationFn: () =>
      api.post<{
        deployed: boolean;
        hostname: string;
        syncedUsers: number;
        warning: string | null;
      }>('/cloudflare/endpoints/deploy', {
        nodeId,
        scriptName: scriptName.trim(),
        ...(zoneId ? { zoneId } : {}),
        ...(routeHost.trim() ? { routeHost: routeHost.trim() } : {}),
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['cf-endpoints'] });
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      toast.success(`endpoint منتشر شد: ${data.hostname}`);
      if (data.warning) toast.info(data.warning);
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const details = error.details as { message?: string } | undefined;
        toast.error(details?.message ?? error.message);
        return;
      }
      toast.error('انتشار ناموفق بود.');
    },
  });

  return (
    <Modal
      open={open}
      title="انتشار endpoint روی Cloudflare"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button
            onClick={() => deploy.mutate()}
            loading={deploy.isPending}
            disabled={!nodeId || scriptName.trim().length < 3}
            icon={<Rocket className="h-4 w-4" />}
          >
            انتشار
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-ink-100 p-3 text-xs leading-6 text-ink-700 dark:bg-ink-950 dark:text-ink-200">
          کد Worker به‌صورت واقعی از طریق Cloudflare API منتشر می‌شود و به همان دیتابیس D1 و فضای KV
          پنل bind می‌گردد. سپس میزبان Node به آدرس جدید به‌روزرسانی می‌شود.
        </p>

        <Field label="سرور مقصد" hint="فقط سرورهای نوع Cloudflare" required>
          <Select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {nodes.data?.items.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} ({node.protocol})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="نام Worker" hint="حروف کوچک لاتین، رقم و خط تیره" required>
          <Input
            ltr
            value={scriptName}
            onChange={(event) => setScriptName(event.target.value.toLowerCase())}
          />
        </Field>

        <Field label="Zone (اختیاری)" hint="برای اتصال دامنهٔ اختصاصی">
          <Select value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
            <option value="">— بدون دامنهٔ اختصاصی (workers.dev) —</option>
            {zones.data?.items.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </Select>
        </Field>

        {zoneId && (
          <Field label="میزبان مسیر" hint="مثال: cdn.example.com" required>
            <Input ltr value={routeHost} onChange={(event) => setRouteHost(event.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function CredentialsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [apiToken, setApiToken] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.put('/cloudflare/settings', {
        accountId: accountId.trim() || null,
        apiToken: apiToken.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cf-status'] });
      setApiToken('');
      toast.success('اعتبارنامه ذخیره شد (رمزنگاری‌شده در دیتابیس).');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="اعتبارنامهٔ Cloudflare"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} icon={<Cloud className="h-4 w-4" />}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          توکن با AES-256-GCM رمزنگاری و فقط سمت سرور استفاده می‌شود؛ هرگز به فرانت‌اند بازگردانده
          نمی‌شود. روش امن‌تر، استفاده از
          <code className="ltr mx-1">wrangler secret put</code>
          است. از توکن scoped با کمترین مجوز لازم استفاده کنید.
        </p>
        <Field label="Account ID">
          <Input ltr value={accountId} onChange={(event) => setAccountId(event.target.value)} />
        </Field>
        <Field label="API Token" hint="Workers Scripts: Edit، KV: Edit، D1: Edit و در صورت نیاز DNS: Edit">
          <Input
            ltr
            type="password"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
