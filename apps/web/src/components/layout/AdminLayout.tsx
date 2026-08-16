import clsx from 'clsx';
import {
  Activity,
  Cloud,
  Database,
  Globe2,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Moon,
  Network,
  Route,
  ScrollText,
  Send,
  Server,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { applyTheme, getStoredTheme } from '../../lib/theme';
import type { ThemeMode } from '../../lib/theme';
import { Badge, Button } from '../ui';
import { NotificationsButton } from '../NotificationsButton';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'داشبورد', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/users', label: 'کاربران', icon: <Users className="h-5 w-5" />, permission: 'users.read' },
  { to: '/nodes', label: 'سرورها', icon: <Server className="h-5 w-5" />, permission: 'nodes.read' },
  {
    to: '/cloudflare',
    label: 'Cloudflare',
    icon: <Cloud className="h-5 w-5" />,
    permission: 'cloudflare.read',
  },
  { to: '/routing', label: 'مسیریابی', icon: <Route className="h-5 w-5" />, permission: 'routing.read' },
  { to: '/dns', label: 'DNS و فیلترینگ', icon: <Globe2 className="h-5 w-5" />, permission: 'dns.read' },
  {
    to: '/chains',
    label: 'زنجیرهٔ پروکسی',
    icon: <Link2 className="h-5 w-5" />,
    permission: 'chains.read',
  },
  {
    to: '/backends',
    label: 'بک‌اند و WARP',
    icon: <Network className="h-5 w-5" />,
    permission: 'backends.read',
  },
  { to: '/telegram', label: 'تلگرام', icon: <Send className="h-5 w-5" />, permission: 'telegram.manage' },
  {
    to: '/analytics',
    label: 'تحلیل‌ها',
    icon: <Activity className="h-5 w-5" />,
    permission: 'analytics.read',
  },
  { to: '/audit', label: 'رویدادها', icon: <ScrollText className="h-5 w-5" />, permission: 'audit.read' },
  {
    to: '/backup',
    label: 'پشتیبان‌گیری',
    icon: <Database className="h-5 w-5" />,
    permission: 'backup.manage',
  },
  {
    to: '/settings',
    label: 'تنظیمات',
    icon: <Settings className="h-5 w-5" />,
    permission: 'settings.read',
  },
];

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'روشن',
  dark: 'تیره',
  system: 'سیستم',
};

export function AdminLayout(): JSX.Element {
  const { me, can, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme());
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  const cycleTheme = (): void => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="flex min-h-full flex-col bg-ink-50 dark:bg-ink-950 lg:flex-row">
      {/* نوار کناری دسکتاپ */}
      <aside className="hidden w-64 shrink-0 border-l border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 lg:block">
        <Brand panelName={me?.settings.panelName ?? 'پنل افرا'} version={me?.settings.version} />
        <nav className="mt-6 flex flex-col gap-1">
          {visibleItems.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-200 bg-white/90 px-3 py-2.5 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-xl p-2 text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800 lg:hidden"
            aria-label="نمایش منو"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
              {me?.settings.panelName ?? 'پنل افرا'}
            </p>
            <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">
              {me?.admin.username} — {me?.admin.roleLabelFa}
            </p>
          </div>

          {me?.settings.maintenanceMode && <Badge tone="amber">حالت تعمیرات</Badge>}
          {me?.settings.environment !== 'production' && (
            <Badge tone="blue" className="hidden sm:inline-flex">
              {me?.settings.environment}
            </Badge>
          )}

          <NotificationsButton />

          <button
            type="button"
            onClick={cycleTheme}
            title={`پوستهٔ فعلی: ${THEME_LABELS[theme]}`}
            className="rounded-xl p-2 text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
            aria-label="تغییر پوسته"
          >
            {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-xl p-2 text-ink-600 transition hover:bg-red-50 hover:text-red-600 dark:text-ink-300 dark:hover:bg-red-950"
            aria-label="خروج از حساب"
            title="خروج"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
          <Outlet />
        </main>

        <footer className="border-t border-ink-200 px-4 py-3 text-center text-[11px] text-ink-500 dark:border-ink-800 dark:text-ink-400">
          پنل افرا — نسخهٔ {me?.settings.version ?? '1.0.0'} · اجرا روی Cloudflare Workers
        </footer>
      </div>

      {/* کشوی موبایل */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 right-0 w-72 max-w-[85vw] overflow-y-auto bg-white p-4 dark:bg-ink-900">
            <div className="flex items-center justify-between">
              <Brand panelName={me?.settings.panelName ?? 'پنل افرا'} />
              <Button variant="ghost" onClick={() => setMenuOpen(false)} aria-label="بستن منو">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="mt-5 flex flex-col gap-1">
              {visibleItems.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ panelName, version }: { panelName: string; version?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-afra-600 text-lg font-bold text-white">
        ا
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{panelName}</p>
        {version && <p className="text-[11px] text-ink-500 dark:text-ink-400">نسخهٔ {version}</p>}
      </div>
    </div>
  );
}

function NavItemLink({ item }: { item: NavItem }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
          isActive
            ? 'bg-afra-50 font-medium text-afra-800 dark:bg-afra-950 dark:text-afra-200'
            : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
        )
      }
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
