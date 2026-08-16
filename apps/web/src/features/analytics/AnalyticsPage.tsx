import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, toPersianDigits } from '../../lib/format';
import { Button, EmptyState, LoadingState, SectionCard } from '../../components/ui';

type Range = '24h' | '7d' | '30d';

const RANGE_LABELS: Record<Range, string> = {
  '24h': '۲۴ ساعت',
  '7d': '۷ روز',
  '30d': '۳۰ روز',
};

export function AnalyticsPage(): JSX.Element {
  const { me } = useAuth();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [range, setRange] = useState<Range>('7d');

  const traffic = useQuery({
    queryKey: ['analytics-traffic', range],
    queryFn: () =>
      api.get<{
        series: { at: string; bytes: number }[];
        topUsers: { username: string; name: string; bytes: number }[];
      }>(`/analytics/traffic?range=${range}`),
  });

  const health = useQuery({
    queryKey: ['analytics-health', range],
    queryFn: () =>
      api.get<{
        series: { at: string; ok: number; failed: number; avgLatencyMs: number | null }[];
      }>(`/analytics/node-health?range=${range}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGE_LABELS) as Range[]).map((key) => (
          <Button
            key={key}
            variant={range === key ? 'primary' : 'secondary'}
            onClick={() => setRange(key)}
          >
            {RANGE_LABELS[key]}
          </Button>
        ))}
      </div>

      <SectionCard title="مصرف ترافیک" description="جمع بایت‌های ثبت‌شده در هر بازهٔ ساعتی">
        {traffic.isLoading ? (
          <LoadingState />
        ) : (traffic.data?.series.length ?? 0) === 0 ? (
          <EmptyState title="داده‌ای برای این بازه وجود ندارد" />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={traffic.data?.series ?? []}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="at" tickFormatter={(value: string) => value.slice(5, 13)} tick={{ fontSize: 11 }} reversed />
                <YAxis tickFormatter={(value: number) => formatBytes(value)} tick={{ fontSize: 11 }} width={80} orientation="right" />
                <Tooltip
                  formatter={(value: number) => [formatBytes(value), 'مصرف']}
                  labelFormatter={(label: string) => formatDate(label, calendar, true)}
                />
                <Bar dataKey="bytes" fill="#22a568" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="پرمصرف‌ترین کاربران">
          {(traffic.data?.topUsers.length ?? 0) === 0 ? (
            <EmptyState title="داده‌ای موجود نیست" />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {traffic.data?.topUsers.map((user, index) => (
                <li key={user.username} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900 dark:text-ink-50">
                      {toPersianDigits(index + 1)}. {user.name}
                    </p>
                    <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                      {user.username}
                    </p>
                  </div>
                  <span className="text-xs text-ink-700 dark:text-ink-200">
                    {formatBytes(user.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="سلامت سرورها در زمان" description="نتیجهٔ بررسی‌های واقعی سلامت">
          {health.isLoading ? (
            <LoadingState />
          ) : (health.data?.series.length ?? 0) === 0 ? (
            <EmptyState title="بررسی سلامتی ثبت نشده است" />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={health.data?.series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="at" tickFormatter={(value: string) => value.slice(5, 13)} tick={{ fontSize: 11 }} reversed />
                  <YAxis tick={{ fontSize: 11 }} orientation="right" />
                  <Tooltip labelFormatter={(label: string) => formatDate(label, calendar, true)} />
                  <Line type="monotone" dataKey="ok" name="موفق" stroke="#22a568" dot={false} />
                  <Line type="monotone" dataKey="failed" name="ناموفق" stroke="#ef4444" dot={false} />
                  <Line type="monotone" dataKey="avgLatencyMs" name="تأخیر (ms)" stroke="#0ea5e9" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
