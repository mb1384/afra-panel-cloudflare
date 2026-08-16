import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { LoadingState } from './components/ui';
import { AnalyticsPage } from './features/analytics/AnalyticsPage';
import { AuditPage } from './features/audit/AuditPage';
import { LoginPage } from './features/auth/LoginPage';
import { SetupWizard } from './features/auth/SetupWizard';
import { BackendsPage } from './features/backends/BackendsPage';
import { BackupPage } from './features/backup/BackupPage';
import { ChainsPage } from './features/chains/ChainsPage';
import { CloudflarePage } from './features/cloudflare/CloudflarePage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DnsPage } from './features/dns/DnsPage';
import { NodesPage } from './features/nodes/NodesPage';
import { RoutingPage } from './features/routing/RoutingPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { UsersPage } from './features/users/UsersPage';
import { AuthProvider, useAuth, useSetupStatus } from './lib/auth';

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell(): JSX.Element {
  const setup = useSetupStatus();
  const { authenticated, loading } = useAuth();

  if (setup.isLoading || loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-ink-50 dark:bg-ink-950">
        <LoadingState label="در حال آماده‌سازی پنل افرا…" />
      </div>
    );
  }

  if (setup.data && !setup.data.completed) {
    return <SetupWizard status={setup.data} />;
  }

  if (!authenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/cloudflare" element={<CloudflarePage />} />
        <Route path="/routing" element={<RoutingPage />} />
        <Route path="/dns" element={<DnsPage />} />
        <Route path="/chains" element={<ChainsPage />} />
        <Route path="/backends" element={<BackendsPage />} />
        <Route path="/telegram" element={<TelegramLazy />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// جداسازی صفحهٔ تلگرام برای کاهش حجم باندل اولیه
import { lazy, Suspense } from 'react';
const TelegramPage = lazy(() =>
  import('./features/telegram/TelegramPage').then((module) => ({ default: module.TelegramPage })),
);

function TelegramLazy(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <TelegramPage />
    </Suspense>
  );
}
