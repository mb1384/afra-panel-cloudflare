import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, toPersianDigits } from '../../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingState,
  Pagination,
  SectionCard,
  Select,
} from '../../components/ui';

interface AuditRow {
  id: string;
  adminUsername: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  result: string;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface LogRow {
  id: string;
  level: string;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export function AuditPage(): JSX.Element {
  const { me } = useAuth();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [tab, setTab] = useState<'audit' | 'logs'>('audit');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('all');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const audit = useQuery({
    queryKey: ['audit', page, debounced, action, result],
    queryFn: () =>
      api.get<{
        items: AuditRow[];
        total: number;
        pageCount: number;
        availableActions: string[];
      }>(
        `/audit?page=${page}&pageSize=25&result=${result}${action ? `&action=${encodeURIComponent(action)}` : ''}${
          debounced ? `&search=${encodeURIComponent(debounced)}` : ''
        }`,
      ),
    enabled: tab === 'audit',
  });

  const logs = useQuery({
    queryKey: ['app-logs', page],
    queryFn: () => api.get<{ items: LogRow[]; total: number }>(`/audit/logs?page=${page}&pageSize=25`),
    enabled: tab === 'logs',
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button variant={tab === 'audit' ? 'primary' : 'secondary'} onClick={() => { setTab('audit'); setPage(1); }}>
          گزارش رویدادها
        </Button>
        <Button variant={tab === 'logs' ? 'primary' : 'secondary'} onClick={() => { setTab('logs'); setPage(1); }}>
          لاگ سیستم
        </Button>
      </div>

      {tab === 'audit' ? (
        <SectionCard
          title="گزارش رویدادهای مدیریتی"
          description={
            audit.data ? `${toPersianDigits(audit.data.total)} رویداد ثبت شده است` : 'در حال بارگذاری…'
          }
        >
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                className="pr-9"
                placeholder="جستجو در اقدام، مدیر یا شناسه…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              className="sm:w-56"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            >
              <option value="">همهٔ اقدام‌ها</option>
              {audit.data?.availableActions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              className="sm:w-40"
              value={result}
              onChange={(event) => {
                setResult(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">همهٔ نتایج</option>
              <option value="success">موفق</option>
              <option value="failure">ناموفق</option>
            </Select>
          </div>

          {audit.isLoading ? (
            <LoadingState />
          ) : (audit.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="رویدادی یافت نشد" />
          ) : (
            <>
              <div className="table-wrapper">
                <table className="w-full text-right text-sm">
                  <thead className="border-b border-ink-200 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
                    <tr>
                      <th className="p-2 font-medium">زمان</th>
                      <th className="p-2 font-medium">اقدام</th>
                      <th className="p-2 font-medium">مدیر</th>
                      <th className="p-2 font-medium">منبع</th>
                      <th className="p-2 font-medium">IP</th>
                      <th className="p-2 font-medium">نتیجه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
                    {audit.data?.items.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap p-2 text-xs text-ink-600 dark:text-ink-300">
                          {formatDate(row.createdAt, calendar, true)}
                        </td>
                        <td className="ltr p-2 font-mono text-xs">{row.action}</td>
                        <td className="p-2 text-xs">{row.adminUsername ?? 'سیستم'}</td>
                        <td className="ltr p-2 text-xs text-ink-500">
                          {row.resource ?? '—'}
                          {row.resourceId ? `/${row.resourceId.slice(0, 10)}…` : ''}
                        </td>
                        <td className="ltr p-2 text-xs text-ink-500">{row.ip ?? '—'}</td>
                        <td className="p-2">
                          <Badge tone={row.result === 'success' ? 'green' : 'red'}>
                            {row.result === 'success' ? 'موفق' : 'ناموفق'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={audit.data?.pageCount ?? 1} onChange={setPage} />
            </>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="لاگ سیستم" description="رویدادهای سطح هشدار و خطا (بدون هیچ اعتبارنامه‌ای)">
          {logs.isLoading ? (
            <LoadingState />
          ) : (logs.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="لاگی ثبت نشده است" description="این نشانهٔ خوبی است." />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {logs.data?.items.map((log) => (
                <li key={log.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={log.level === 'ERROR' ? 'red' : 'amber'}>{log.level}</Badge>
                    <span className="text-[11px] text-ink-500">
                      {formatDate(log.createdAt, calendar, true)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-800 dark:text-ink-100">{log.message}</p>
                  {log.context && (
                    <pre className="ltr mt-1 max-h-32 overflow-auto rounded-lg bg-ink-100 p-2 text-[11px] dark:bg-ink-950">
                      {JSON.stringify(log.context, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
