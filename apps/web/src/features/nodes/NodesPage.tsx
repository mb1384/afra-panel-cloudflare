import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, toPersianDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  NodeHealthIndicator,
  SectionCard,
  Select,
} from '../../components/ui';
import { NodeFormModal } from './NodeFormModal';

interface NodeRow {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  hostname: string;
  port: number;
  protocol: string;
  transport: { kind: string; path: string | null };
  health: string;
  latencyMs: number | null;
  lastCheckAt: string | null;
  priority: number;
  weight: number;
  enabled: boolean;
  cfWorkerName: string | null;
  successCount: number;
  failureCount: number;
}

export function NodesPage(): JSX.Element {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const calendar = me?.settings.calendar ?? 'jalali';

  const [health, setHealth] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NodeRow | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setFormOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const query = useQuery({
    queryKey: ['nodes', health],
    queryFn: () => api.get<{ items: NodeRow[]; total: number }>(`/nodes?pageSize=100&health=${health}`),
  });

  const balance = useQuery({
    queryKey: ['balance-preview'],
    queryFn: () =>
      api.get<{
        strategy: string;
        failoverEnabled: boolean;
        order: { rank: number; name: string; health: string; latencyMs: number | null }[];
      }>('/nodes/balance-preview'),
  });

  const checkAll = useMutation({
    mutationFn: () => api.post<{ result: unknown }>('/nodes/check-all'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      await queryClient.invalidateQueries({ queryKey: ['balance-preview'] });
      toast.success('بررسی سلامت انجام شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بررسی سلامت ناموفق بود.'),
  });

  const checkOne = useMutation({
    mutationFn: (id: string) => api.post(`/nodes/${id}/check`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      toast.success('بررسی سلامت این سرور انجام شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بررسی ناموفق بود.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/nodes/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setPendingDelete(null);
      toast.success('سرور حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  const rows = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="سرورها (Nodes)"
        description="endpointهای Cloudflare و سرورهای بیرونی. بررسی سلامت با اتصال واقعی TCP/TLS انجام می‌شود."
        actions={
          <>
            <Select className="w-40" value={health} onChange={(event) => setHealth(event.target.value)}>
              <option value="all">همهٔ وضعیت‌ها</option>
              <option value="healthy">سالم</option>
              <option value="degraded">کند</option>
              <option value="unreachable">خارج از دسترس</option>
              <option value="unknown">بررسی‌نشده</option>
            </Select>
            <Button
              variant="secondary"
              icon={<Activity className="h-4 w-4" />}
              onClick={() => checkAll.mutate()}
              loading={checkAll.isPending}
            >
              بررسی سلامت همه
            </Button>
            {can('nodes.write') && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditingId(null);
                  setFormOpen(true);
                }}
              >
                سرور جدید
              </Button>
            )}
          </>
        }
      >
        {balance.data && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
            <Badge tone="blue">استراتژی توازن: {balance.data.strategy}</Badge>
            <Badge tone={balance.data.failoverEnabled ? 'green' : 'gray'}>
              failover: {balance.data.failoverEnabled ? 'فعال' : 'غیرفعال'}
            </Badge>
            {balance.data.order.slice(0, 3).map((item) => (
              <Badge key={item.rank} tone="gray">
                {toPersianDigits(item.rank)}. {item.name}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      {query.isLoading ? (
        <LoadingState label="در حال دریافت سرورها…" />
      ) : query.error ? (
        <ErrorState message="دریافت فهرست سرورها ناموفق بود." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="سروری ثبت نشده است"
            description="برای شروع یک endpoint روی Cloudflare بسازید یا سرور بیرونی خود را اضافه کنید."
            action={
              can('nodes.write') ? (
                <Button icon={<Server className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                  افزودن سرور
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {rows.map((node) => (
            <article key={node.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900 dark:text-ink-50">
                    {node.displayName || node.name}
                  </p>
                  <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                    {node.hostname}:{node.port}
                  </p>
                </div>
                <NodeHealthIndicator health={node.health} latencyMs={node.latencyMs} />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone="blue">{node.protocol.toUpperCase()}</Badge>
                <Badge tone="gray">{node.transport.kind}</Badge>
                <Badge tone={node.kind === 'cloudflare-edge' ? 'green' : 'gray'}>
                  {node.kind === 'cloudflare-edge' ? 'Cloudflare' : 'بیرونی'}
                </Badge>
                {!node.enabled && <Badge tone="amber">غیرفعال</Badge>}
                {node.cfWorkerName && <Badge tone="blue">{node.cfWorkerName}</Badge>}
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs text-ink-600 dark:text-ink-300">
                <div>
                  <dt className="text-ink-500 dark:text-ink-400">اولویت / وزن</dt>
                  <dd>
                    {toPersianDigits(node.priority)} / {toPersianDigits(node.weight)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500 dark:text-ink-400">آخرین بررسی</dt>
                  <dd>{formatDate(node.lastCheckAt, calendar, true)}</dd>
                </div>
                <div>
                  <dt className="text-ink-500 dark:text-ink-400">موفق / ناموفق</dt>
                  <dd>
                    {toPersianDigits(node.successCount)} / {toPersianDigits(node.failureCount)}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  icon={<Activity className="h-4 w-4" />}
                  onClick={() => checkOne.mutate(node.id)}
                  loading={checkOne.isPending && checkOne.variables === node.id}
                >
                  بررسی
                </Button>
                {can('nodes.write') && (
                  <Button
                    variant="secondary"
                    icon={<Pencil className="h-4 w-4" />}
                    onClick={() => {
                      setEditingId(node.id);
                      setFormOpen(true);
                    }}
                  >
                    ویرایش
                  </Button>
                )}
                {can('nodes.delete') && (
                  <Button
                    variant="ghost"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setPendingDelete(node)}
                  >
                    حذف
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <NodeFormModal
        open={formOpen}
        nodeId={editingId}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف سرور"
        message={`با حذف «${pendingDelete?.name ?? ''}» این سرور از اشتراک همهٔ کاربران خارج می‌شود. ادامه می‌دهید؟`}
        confirmLabel="حذف سرور"
        danger
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}
