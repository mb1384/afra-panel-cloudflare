import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  MoreVertical,
  Pencil,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, daysLabel, toPersianDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Pagination,
  SectionCard,
  Select,
  StatusBadge,
} from '../../components/ui';
import { SubscriptionModal } from './SubscriptionModal';
import { UserFormModal } from './UserFormModal';

interface UserRow {
  id: string;
  name: string;
  username: string;
  state: string;
  enabled: boolean;
  usedBytes: number;
  quotaBytes: number | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
  tags: string[];
  createdAt: string;
}

interface UsersResponse {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const STATES = [
  { value: 'all', label: 'همه' },
  { value: 'active', label: 'فعال' },
  { value: 'disabled', label: 'غیرفعال' },
  { value: 'expired', label: 'منقضی‌شده' },
  { value: 'exhausted', label: 'حجم تمام‌شده' },
];

export function UsersPage(): JSX.Element {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const calendar = me?.settings.calendar ?? 'jalali';

  const [page, setPage] = useState(1);
  const [state, setState] = useState('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [formOpen, setFormOpen] = useState(searchParams.get('new') === '1');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setFormOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const query = useQuery({
    queryKey: ['users', page, state, debounced],
    queryFn: () =>
      api.get<UsersResponse>(
        `/users?page=${page}&pageSize=20&state=${state}${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    await queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
  };

  const action = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => api.post(`/users/${id}/${path}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('عملیات با موفقیت انجام شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'عملیات ناموفق بود.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
      toast.success('کاربر حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  const bulk = useMutation({
    mutationFn: (bulkAction: string) =>
      api.post<{ affected: number }>('/users/bulk', { ids: selected, action: bulkAction }),
    onSuccess: async (data) => {
      await invalidate();
      setSelected([]);
      toast.success(`${toPersianDigits(data.affected)} کاربر به‌روزرسانی شد.`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'عملیات گروهی ناموفق بود.'),
  });

  const rows = query.data?.items ?? [];
  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((row) => selected.includes(row.id)),
    [rows, selected],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="کاربران"
        description={
          query.data ? `${toPersianDigits(query.data.total)} کاربر ثبت شده است` : 'در حال بارگذاری…'
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void query.refetch()}
            >
              بازخوانی
            </Button>
            {can('users.write') && (
              <Button
                icon={<UserPlus className="h-4 w-4" />}
                onClick={() => {
                  setEditingId(null);
                  setFormOpen(true);
                }}
              >
                کاربر جدید
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pr-9"
              placeholder="جستجو بر اساس نام یا نام کاربری…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="sm:w-48"
            value={state}
            onChange={(event) => {
              setState(event.target.value);
              setPage(1);
            }}
          >
            {STATES.map((item) => (
              <option key={item.value} value={item.value}>
                وضعیت: {item.label}
              </option>
            ))}
          </Select>
        </div>

        {selected.length > 0 && can('users.write') && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-afra-50 p-3 dark:bg-afra-950">
            <span className="text-xs text-afra-900 dark:text-afra-200">
              {toPersianDigits(selected.length)} کاربر انتخاب شده
            </span>
            <Button variant="secondary" onClick={() => bulk.mutate('enable')} loading={bulk.isPending}>
              فعال‌سازی
            </Button>
            <Button variant="secondary" onClick={() => bulk.mutate('disable')} loading={bulk.isPending}>
              غیرفعال‌سازی
            </Button>
            <Button
              variant="secondary"
              onClick={() => bulk.mutate('reset-traffic')}
              loading={bulk.isPending}
            >
              بازنشانی حجم
            </Button>
            <Button variant="ghost" onClick={() => setSelected([])}>
              لغو انتخاب
            </Button>
          </div>
        )}
      </SectionCard>

      {query.isLoading ? (
        <LoadingState label="در حال دریافت کاربران…" />
      ) : query.error ? (
        <ErrorState message="دریافت فهرست کاربران ناموفق بود." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="کاربری یافت نشد"
            description="با ایجاد نخستین کاربر، لینک اشتراک و کد QR بلافاصله در دسترس قرار می‌گیرد."
            action={
              can('users.write') ? (
                <Button
                  icon={<UserPlus className="h-4 w-4" />}
                  onClick={() => {
                    setEditingId(null);
                    setFormOpen(true);
                  }}
                >
                  ایجاد کاربر
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* جدول دسکتاپ */}
          <div className="card hidden md:block">
            <div className="table-wrapper">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-ink-200 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
                  <tr>
                    <th className="p-3">
                      <input
                        type="checkbox"
                        aria-label="انتخاب همه"
                        className="h-4 w-4 accent-afra-600"
                        checked={allSelected}
                        onChange={(event) =>
                          setSelected(event.target.checked ? rows.map((row) => row.id) : [])
                        }
                      />
                    </th>
                    <th className="p-3 font-medium">کاربر</th>
                    <th className="p-3 font-medium">وضعیت</th>
                    <th className="p-3 font-medium">مصرف</th>
                    <th className="p-3 font-medium">انقضا</th>
                    <th className="p-3 font-medium">آخرین فعالیت</th>
                    <th className="p-3 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/50">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`انتخاب ${row.name}`}
                          className="h-4 w-4 accent-afra-600"
                          checked={selected.includes(row.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, row.id]
                                : current.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                      <td className="p-3">
                        <p className="font-medium text-ink-900 dark:text-ink-50">{row.name}</p>
                        <p className="ltr text-xs text-ink-500 dark:text-ink-400">{row.username}</p>
                      </td>
                      <td className="p-3">
                        <StatusBadge state={row.state} />
                      </td>
                      <td className="p-3">
                        <p className="text-xs text-ink-700 dark:text-ink-200">
                          {formatBytes(row.usedBytes)} / {formatBytes(row.quotaBytes)}
                        </p>
                        {row.quotaBytes && (
                          <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                            <div
                              className="h-full rounded-full bg-afra-500"
                              style={{
                                width: `${Math.min(100, (row.usedBytes / row.quotaBytes) * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-xs text-ink-600 dark:text-ink-300">
                        {formatDate(row.expiresAt, calendar)}
                        <span className="block text-[11px] text-ink-400">{daysLabel(row.expiresAt)}</span>
                      </td>
                      <td className="p-3 text-xs text-ink-600 dark:text-ink-300">
                        {formatDate(row.lastActivityAt, calendar, true)}
                      </td>
                      <td className="p-3">
                        <RowActions
                          row={row}
                          canWrite={can('users.write')}
                          canDelete={can('users.delete')}
                          onSubscription={() => setSubscriptionId(row.id)}
                          onEdit={() => {
                            setEditingId(row.id);
                            setFormOpen(true);
                          }}
                          onAction={(path) => action.mutate({ id: row.id, path })}
                          onDelete={() => setPendingDelete(row)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={query.data?.pageCount ?? 1} onChange={setPage} />
          </div>

          {/* کارت‌های موبایل */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <article key={row.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900 dark:text-ink-50">{row.name}</p>
                    <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                      {row.username}
                    </p>
                  </div>
                  <StatusBadge state={row.state} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-500 dark:text-ink-400">مصرف</dt>
                    <dd className="text-ink-800 dark:text-ink-100">
                      {formatBytes(row.usedBytes)} / {formatBytes(row.quotaBytes)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500 dark:text-ink-400">انقضا</dt>
                    <dd className="text-ink-800 dark:text-ink-100">{daysLabel(row.expiresAt)}</dd>
                  </div>
                </dl>

                {row.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Badge key={tag} tone="gray">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<QrCode className="h-4 w-4" />}
                    onClick={() => setSubscriptionId(row.id)}
                  >
                    اشتراک
                  </Button>
                  {can('users.write') && (
                    <>
                      <Button
                        variant="secondary"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => {
                          setEditingId(row.id);
                          setFormOpen(true);
                        }}
                      >
                        ویرایش
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          action.mutate({ id: row.id, path: row.enabled ? 'disable' : 'enable' })
                        }
                      >
                        {row.enabled ? 'غیرفعال' : 'فعال'}
                      </Button>
                    </>
                  )}
                  {can('users.delete') && (
                    <Button
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setPendingDelete(row)}
                    >
                      حذف
                    </Button>
                  )}
                </div>
              </article>
            ))}
            <Pagination page={page} pageCount={query.data?.pageCount ?? 1} onChange={setPage} />
          </div>
        </>
      )}

      <UserFormModal
        open={formOpen}
        userId={editingId}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        onCreated={(id) => setSubscriptionId(id)}
      />

      <SubscriptionModal
        open={Boolean(subscriptionId)}
        userId={subscriptionId}
        onClose={() => setSubscriptionId(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف کاربر"
        message={`آیا از حذف «${pendingDelete?.name ?? ''}» مطمئن هستید؟ اشتراک و دسترسی او فوراً از کار می‌افتد و این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="حذف کاربر"
        danger
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}

function RowActions({
  row,
  canWrite,
  canDelete,
  onSubscription,
  onEdit,
  onAction,
  onDelete,
}: {
  row: UserRow;
  canWrite: boolean;
  canDelete: boolean;
  onSubscription: () => void;
  onEdit: () => void;
  onAction: (path: string) => void;
  onDelete: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={onSubscription}
        title="اشتراک و کد QR"
        className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        <Link2 className="h-4 w-4" />
      </button>
      {canWrite && (
        <button
          type="button"
          onClick={onEdit}
          title="ویرایش"
          className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title="عملیات بیشتر"
        className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-card dark:border-ink-800 dark:bg-ink-900">
            {canWrite && (
              <>
                <MenuItem
                  label={row.enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                  onClick={() => {
                    onAction(row.enabled ? 'disable' : 'enable');
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="بازنشانی حجم"
                  icon={<RotateCcw className="h-4 w-4" />}
                  onClick={() => {
                    onAction('reset-traffic');
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="چرخش اعتبارنامه"
                  onClick={() => {
                    onAction('rotate-credentials');
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="چرخش توکن اشتراک"
                  onClick={() => {
                    onAction('rotate-token');
                    setOpen(false);
                  }}
                />
              </>
            )}
            {canDelete && (
              <MenuItem
                label="حذف کاربر"
                danger
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => {
                  onDelete();
                  setOpen(false);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  icon,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  icon?: JSX.Element;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs transition hover:bg-ink-100 dark:hover:bg-ink-800 ${
        danger ? 'text-red-600 dark:text-red-400' : 'text-ink-700 dark:text-ink-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
