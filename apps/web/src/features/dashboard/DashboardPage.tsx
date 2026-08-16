import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Cloud,
  Globe2,
  HardDrive,
  Send,
  Server,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, relativeTime, toPersianDigits } from '../../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionCard,
  StatCard,
  StatusBadge,
} from '../../components/ui';

interface Overview {
  stats: {
    users: { total: number; active: number; expired: number; disabled: number };
    traffic: { usedBytes: number; quotaBytes: number; remainingBytes: number | null };
    nodes: {
      total: number;
      healthy: number;
      degraded: number;
      unreachable: number;
      avgLatencyMs: number | null;
    };
    backend: { total: number; healthy: number };
    dns: { total: number; healthy: number };
    telegram: { configured: boolean; healthy: boolean };
    cloudflare: { configured: boolean; healthy: boolean; accountId: string | null };
    system: { environment: string; version: string; time: string };
  };
  recentEvents: {
    action: string;
    resource: string | null;
    result: string;
    adminUsername: string | null;
    createdAt: string;
  }[];
  recentUsers: {
    id: string;
    name: string;
    username: string;
    enabled: boolean;
    usedBytes: number;
    quotaBytes: number | null;
    expiresAt: string | null;
    createdAt: string;
  }[];
}

interface TrafficSeries {
  range: string;
  series: { at: string; bytes: number }[];
  topUsers: { username: string; name: string; bytes: number }[];
}

const NODE_COLORS = ['#22a568', '#f59e0b', '#ef4444', '#94a3b8'];

export function DashboardPage(): JSX.Element {
  const { me, can } = useAuth();
  const calendar = me?.settings.calendar ?? 'jalali';

  const overview = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get<Overview>('/analytics/overview'),
    refetchInterval: 60_000,
  });

  const traffic = useQuery({
    queryKey: ['analytics-traffic', '7d'],
    queryFn: () => api.get<TrafficSeries>('/analytics/traffic?range=7d'),
    enabled: can('analytics.read'),
  });

  if (overview.isLoading) return <LoadingState label="در حال دریافت آمار…" />;
  if (overview.error || !overview.data) {
    return (
      <ErrorState
        message="دریافت آمار داشبورد ناموفق بود."
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const { stats, recentEvents, recentUsers } = overview.data;
  const nodePie = [
    { name: 'سالم', value: stats.nodes.healthy },
    { name: 'کند', value: stats.nodes.degraded },
    { name: 'خارج از دسترس', value: stats.nodes.unreachable },
    {
      name: 'بررسی‌نشده',
      value: Math.max(
        stats.nodes.total - stats.nodes.healthy - stats.nodes.degraded - stats.nodes.unreachable,
        0,
      ),
    },
  ].filter((item) => item.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="card-grid">
        <StatCard
          label="تعداد کاربران"
          value={toPersianDigits(stats.users.total)}
          hint={`${toPersianDigits(stats.users.active)} فعال · ${toPersianDigits(stats.users.expired)} منقضی`}
          icon={<Users className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="حجم مصرف‌شده"
          value={formatBytes(stats.traffic.usedBytes)}
          hint={
            stats.traffic.remainingBytes === null
              ? 'سهمیهٔ نامحدود در بین کاربران'
              : `باقی‌مانده: ${formatBytes(stats.traffic.remainingBytes)}`
          }
          icon={<HardDrive className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="سرورها"
          value={`${toPersianDigits(stats.nodes.healthy)} / ${toPersianDigits(stats.nodes.total)}`}
          hint={
            stats.nodes.avgLatencyMs === null
              ? 'هنوز بررسی نشده'
              : `میانگین تأخیر ${toPersianDigits(stats.nodes.avgLatencyMs)} میلی‌ثانیه`
          }
          icon={<Server className="h-5 w-5" />}
          tone={stats.nodes.unreachable > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="وضعیت سرویس‌ها"
          value={stats.cloudflare.configured ? 'Cloudflare متصل' : 'Cloudflare تنظیم نشده'}
          hint={`DNS ${toPersianDigits(stats.dns.healthy)}/${toPersianDigits(stats.dns.total)} · بک‌اند ${toPersianDigits(stats.backend.healthy)}/${toPersianDigits(stats.backend.total)}`}
          icon={<Cloud className="h-5 w-5" />}
          tone={stats.cloudflare.configured ? 'green' : 'amber'}
        />
      </div>

      <SectionCard title="اقدام‌های سریع" description="کارهای پرتکرار مدیریت">
        <div className="flex flex-wrap gap-2">
          {can('users.write') && (
            <Link to="/users?new=1">
              <Button icon={<UserPlus className="h-4 w-4" />}>ایجاد کاربر</Button>
            </Link>
          )}
          {can('nodes.write') && (
            <Link to="/nodes?new=1">
              <Button variant="secondary" icon={<Server className="h-4 w-4" />}>
                افزودن سرور
              </Button>
            </Link>
          )}
          {can('nodes.read') && (
            <Link to="/nodes">
              <Button variant="secondary" icon={<Activity className="h-4 w-4" />}>
                بررسی سلامت سرورها
              </Button>
            </Link>
          )}
          {can('dns.read') && (
            <Link to="/dns">
              <Button variant="secondary" icon={<Globe2 className="h-4 w-4" />}>
                تنظیمات DNS
              </Button>
            </Link>
          )}
          {can('telegram.manage') && (
            <Link to="/telegram">
              <Button variant="secondary" icon={<Send className="h-4 w-4" />}>
                تنظیمات تلگرام
              </Button>
            </Link>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <SectionCard title="ترافیک هفت روز گذشته" description="بر پایهٔ نمونه‌های ثبت‌شدهٔ واقعی">
            {traffic.isLoading ? (
              <LoadingState />
            ) : (traffic.data?.series.length ?? 0) === 0 ? (
              <EmptyState
                title="هنوز ترافیکی ثبت نشده"
                description="پس از اتصال کاربران، مصرف در این نمودار نمایش داده می‌شود."
              />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={traffic.data?.series ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
                    <XAxis
                      dataKey="at"
                      tickFormatter={(value: string) => value.slice(5, 10)}
                      tick={{ fontSize: 11 }}
                      reversed
                    />
                    <YAxis
                      tickFormatter={(value: number) => formatBytes(value)}
                      tick={{ fontSize: 11 }}
                      width={80}
                      orientation="right"
                    />
                    <Tooltip
                      formatter={(value: number) => [formatBytes(value), 'مصرف']}
                      labelFormatter={(label: string) => formatDate(label, calendar, true)}
                    />
                    <Area
                      type="monotone"
                      dataKey="bytes"
                      stroke="#158554"
                      fill="#22a568"
                      fillOpacity={0.2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard title="سلامت سرورها">
          {nodePie.length === 0 ? (
            <EmptyState title="سروری ثبت نشده" />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={nodePie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                    {nodePie.map((entry, index) => (
                      <Cell key={entry.name} fill={NODE_COLORS[index % NODE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [toPersianDigits(value), name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="کاربران تازه">
          {recentUsers.length === 0 ? (
            <EmptyState title="کاربری ایجاد نشده است" />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {recentUsers.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                      {user.name}
                    </p>
                    <p className="ltr truncate text-xs text-ink-500 dark:text-ink-400">
                      {user.username}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-ink-500 dark:text-ink-400">
                      {formatBytes(user.usedBytes)}
                    </span>
                    <StatusBadge state={user.enabled ? 'active' : 'disabled'} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="رویدادهای اخیر">
          {recentEvents.length === 0 ? (
            <EmptyState title="رویدادی ثبت نشده است" />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
              {recentEvents.map((event, index) => (
                <li key={`${event.action}-${index}`} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="ltr truncate text-xs font-medium text-ink-800 dark:text-ink-100">
                      {event.action}
                    </p>
                    <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">
                      {event.adminUsername ?? 'سیستم'} · {relativeTime(event.createdAt)}
                    </p>
                  </div>
                  <Badge tone={event.result === 'success' ? 'green' : 'red'}>
                    {event.result === 'success' ? 'موفق' : 'ناموفق'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
