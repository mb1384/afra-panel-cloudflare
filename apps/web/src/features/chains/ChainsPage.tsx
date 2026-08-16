import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Link2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
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

interface Hop {
  kind: 'node' | 'socks5' | 'http' | 'https-connect';
  nodeId?: string;
  host?: string;
  port?: number;
  username?: string | null;
  password?: string | null;
}

interface Chain {
  id: string;
  name: string;
  hops: Hop[];
  enabled: boolean;
  notes: string | null;
}

const HOP_LABELS: Record<Hop['kind'], string> = {
  node: 'سرور افرا',
  socks5: 'SOCKS5',
  http: 'HTTP',
  'https-connect': 'HTTPS CONNECT',
};

export function ChainsPage(): JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Chain | null>(null);

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<{ items: Chain[] }>('/proxy-chains'),
  });

  const nodes = useQuery({
    queryKey: ['node-options'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/nodes?pageSize=200'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/proxy-chains/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chains'] });
      setPendingDelete(null);
      toast.success('زنجیره حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  const nodeName = (id?: string): string =>
    nodes.data?.items.find((node) => node.id === id)?.name ?? id ?? '—';

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="زنجیرهٔ پروکسی"
        description="مسیر چند مرحله‌ای: کلاینت ← سرور اول ← سرور دوم ← اینترنت. هر زنجیره پیش از ذخیره اعتبارسنجی می‌شود."
        actions={
          can('chains.write') ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditorOpen(true)}>
              زنجیرهٔ جدید
            </Button>
          ) : undefined
        }
      >
        {chains.isLoading ? (
          <LoadingState />
        ) : (chains.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="زنجیره‌ای ثبت نشده است"
            description="زنجیره برای عبور ترافیک از چند گام پیاپی استفاده می‌شود."
          />
        ) : (
          <div className="card-grid">
            {chains.data?.items.map((chain) => (
              <article key={chain.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium text-ink-900 dark:text-ink-50">{chain.name}</p>
                  <Badge tone={chain.enabled ? 'green' : 'gray'}>
                    {chain.enabled ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </div>

                <ol className="mt-3 flex flex-col gap-1 text-xs">
                  <li className="rounded-lg bg-ink-100 px-2 py-1.5 text-ink-600 dark:bg-ink-950 dark:text-ink-300">
                    کلاینت
                  </li>
                  {chain.hops.map((hop, index) => (
                    <li key={`${chain.id}-${index}`} className="flex flex-col gap-1">
                      <ArrowDown className="mx-auto h-3 w-3 text-ink-400" />
                      <span className="rounded-lg bg-afra-50 px-2 py-1.5 text-afra-900 dark:bg-afra-950 dark:text-afra-200">
                        {HOP_LABELS[hop.kind]}:{' '}
                        <span className="ltr">
                          {hop.kind === 'node' ? nodeName(hop.nodeId) : `${hop.host}:${hop.port}`}
                        </span>
                      </span>
                    </li>
                  ))}
                  <li className="flex flex-col gap-1">
                    <ArrowDown className="mx-auto h-3 w-3 text-ink-400" />
                    <span className="rounded-lg bg-ink-100 px-2 py-1.5 text-ink-600 dark:bg-ink-950 dark:text-ink-300">
                      اینترنت
                    </span>
                  </li>
                </ol>

                {chain.notes && (
                  <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{chain.notes}</p>
                )}

                {can('chains.write') && (
                  <Button
                    variant="ghost"
                    className="mt-3"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setPendingDelete(chain)}
                  >
                    حذف
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <ChainEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        nodes={nodes.data?.items ?? []}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف زنجیره"
        message={`زنجیرهٔ «${pendingDelete?.name ?? ''}» حذف شود؟`}
        danger
        confirmLabel="حذف"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}

function ChainEditor({
  open,
  onClose,
  nodes,
}: {
  open: boolean;
  onClose: () => void;
  nodes: { id: string; name: string }[];
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [hops, setHops] = useState<Hop[]>([
    { kind: 'node', nodeId: '' },
    { kind: 'socks5', host: '', port: 1080 },
  ]);
  const [issues, setIssues] = useState<{ index: number; message: string }[]>([]);

  const payload = (): unknown => ({
    name: name.trim(),
    notes: notes.trim() || null,
    enabled: true,
    hops: hops.map((hop) =>
      hop.kind === 'node'
        ? { kind: hop.kind, nodeId: hop.nodeId }
        : { kind: hop.kind, host: hop.host, port: Number(hop.port) },
    ),
  });

  const validate = useMutation({
    mutationFn: () =>
      api.post<{ valid: boolean; issues: { index: number; message: string }[] }>(
        '/proxy-chains/validate',
        payload(),
      ),
    onSuccess: (data) => {
      setIssues(data.issues);
      if (data.valid) toast.success('زنجیره معتبر است.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'اعتبارسنجی ناموفق بود.'),
  });

  const save = useMutation({
    mutationFn: () => api.post('/proxy-chains', payload()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chains'] });
      toast.success('زنجیره ذخیره شد.');
      setName('');
      setHops([
        { kind: 'node', nodeId: '' },
        { kind: 'socks5', host: '', port: 1080 },
      ]);
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const details = error.details as { issues?: { index: number; message: string }[] } | undefined;
        if (details?.issues) setIssues(details.issues);
        toast.error(error.message);
        return;
      }
      toast.error('ذخیره‌سازی ناموفق بود.');
    },
  });

  const updateHop = (index: number, patch: Partial<Hop>): void =>
    setHops((current) => current.map((hop, position) => (position === index ? { ...hop, ...patch } : hop)));

  return (
    <Modal
      open={open}
      title="ویرایشگر زنجیرهٔ پروکسی"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="secondary" onClick={() => validate.mutate()} loading={validate.isPending}>
            اعتبارسنجی
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            ذخیره زنجیره
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام زنجیره" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800 dark:text-ink-100">گام‌های زنجیره</p>
            <Button
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setHops((current) => [...current, { kind: 'socks5', host: '', port: 1080 }])}
              disabled={hops.length >= 6}
            >
              افزودن گام
            </Button>
          </div>

          {hops.map((hop, index) => {
            const issue = issues.find((item) => item.index === index);
            return (
              <div
                key={index}
                className="rounded-xl border border-ink-200 p-3 dark:border-ink-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="blue">
                    <Link2 className="h-3 w-3" /> گام {index + 1}
                  </Badge>
                  {hops.length > 2 && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setHops((current) => current.filter((_, position) => position !== index))}
                    />
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="نوع گام">
                    <Select
                      value={hop.kind}
                      onChange={(event) => updateHop(index, { kind: event.target.value as Hop['kind'] })}
                    >
                      {Object.entries(HOP_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {hop.kind === 'node' ? (
                    <div className="sm:col-span-2">
                      <Field label="سرور">
                        <Select
                          value={hop.nodeId ?? ''}
                          onChange={(event) => updateHop(index, { nodeId: event.target.value })}
                        >
                          <option value="">— انتخاب کنید —</option>
                          {nodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  ) : (
                    <>
                      <Field label="میزبان">
                        <Input
                          ltr
                          value={hop.host ?? ''}
                          onChange={(event) => updateHop(index, { host: event.target.value })}
                        />
                      </Field>
                      <Field label="پورت">
                        <Input
                          ltr
                          inputMode="numeric"
                          value={String(hop.port ?? '')}
                          onChange={(event) =>
                            updateHop(index, { port: Number(event.target.value.replace(/\D/g, '')) })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>

                {issue && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{issue.message}</p>
                )}
              </div>
            );
          })}
        </div>

        <Field label="یادداشت">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
