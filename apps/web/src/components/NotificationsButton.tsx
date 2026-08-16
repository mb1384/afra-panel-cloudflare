import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Badge, Button, EmptyState, LoadingState, Modal } from './ui';

interface NotificationItem {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const TONES = { info: 'blue', warning: 'amber', error: 'red' } as const;

export function NotificationsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = query.data?.unread ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative rounded-xl p-2 text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
        aria-label={`اعلان‌ها${unread > 0 ? ` (${unread} خوانده‌نشده)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '۹+' : unread}
          </span>
        )}
      </button>

      <Modal
        open={open}
        title="اعلان‌ها"
        onClose={() => setOpen(false)}
        footer={
          <Button
            variant="secondary"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            disabled={unread === 0}
          >
            علامت‌گذاری همه به‌عنوان خوانده‌شده
          </Button>
        }
      >
        {query.isLoading ? (
          <LoadingState />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="اعلانی وجود ندارد" description="رویدادهای مهم سامانه اینجا نمایش داده می‌شوند." />
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data?.items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-ink-200 p-3 dark:border-ink-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{item.title}</p>
                  <Badge tone={TONES[item.severity]}>{relativeTime(item.createdAt)}</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-600 dark:text-ink-300">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
