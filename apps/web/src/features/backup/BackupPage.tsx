import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate } from '../../lib/format';
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
  Toggle,
} from '../../components/ui';

interface BackupItem {
  id: string;
  key: string;
  sizeBytes: number;
  encrypted: boolean;
  hasSecrets: boolean;
  tableCounts: Record<string, number>;
  createdBy: string | null;
  createdAt: string;
}

export function BackupPage(): JSX.Element {
  const { me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const calendar = me?.settings.calendar ?? 'jalali';
  const isSuperAdmin = me?.admin.role === 'super_admin';

  const [createOpen, setCreateOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupItem | null>(null);

  const query = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ storageConfigured: boolean; items: BackupItem[] }>('/backup'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/backup/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
      setPendingDelete(null);
      toast.success('پشتیبان حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="پشتیبان‌گیری و بازگردانی"
        description="پشتیبان‌ها در Cloudflare R2 ذخیره می‌شوند و می‌توانند با عبارت عبور رمزنگاری شوند."
        actions={
          <Button
            icon={<Database className="h-4 w-4" />}
            onClick={() => setCreateOpen(true)}
            disabled={query.data?.storageConfigured === false}
            title={query.data?.storageConfigured === false ? 'فضای R2 پیکربندی نشده است' : undefined}
          >
            پشتیبان جدید
          </Button>
        }
      >
        {query.data?.storageConfigured === false && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            اتصال R2 پیکربندی نشده است. سطل را با
            <code className="ltr mx-1">wrangler r2 bucket create afra-backups</code>
            بسازید و در فایل wrangler.jsonc فعال کنید.
          </p>
        )}

        {query.isLoading ? (
          <LoadingState />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="پشتیبانی ثبت نشده است" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-200 dark:divide-ink-800">
            {query.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="ltr truncate text-xs text-ink-800 dark:text-ink-100">{item.key}</p>
                  <p className="text-[11px] text-ink-500 dark:text-ink-400">
                    {formatDate(item.createdAt, calendar, true)} · {formatBytes(item.sizeBytes)} ·{' '}
                    {item.createdBy ?? 'سیستم'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.encrypted ? 'green' : 'gray'}>
                    {item.encrypted ? 'رمزنگاری‌شده' : 'رمزنگاری‌نشده'}
                  </Badge>
                  <Badge tone={item.hasSecrets ? 'amber' : 'blue'}>
                    {item.hasSecrets ? 'شامل اسرار' : 'بدون اسرار'}
                  </Badge>
                  <a href={`/api/v1/backup/${item.id}/download`} download>
                    <Button variant="secondary" icon={<Download className="h-4 w-4" />}>
                      دانلود
                    </Button>
                  </a>
                  {isSuperAdmin && (
                    <Button
                      variant="secondary"
                      icon={<RotateCcw className="h-4 w-4" />}
                      onClick={() => setRestoreTarget(item)}
                    >
                      بازگردانی
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setPendingDelete(item)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <CreateBackupModal open={createOpen} onClose={() => setCreateOpen(false)} isSuperAdmin={isSuperAdmin} />
      <RestoreModal target={restoreTarget} onClose={() => setRestoreTarget(null)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف پشتیبان"
        message="فایل پشتیبان از R2 حذف می‌شود. ادامه می‌دهید؟"
        danger
        confirmLabel="حذف"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}

function CreateBackupModal({
  open,
  onClose,
  isSuperAdmin,
}: {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post('/backup', {
        includeSecrets,
        encrypt,
        ...(encrypt ? { passphrase } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
      setPassphrase('');
      toast.success('پشتیبان ساخته شد.');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'ساخت پشتیبان ناموفق بود.'),
  });

  return (
    <Modal
      open={open}
      title="ساخت پشتیبان"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={encrypt && passphrase.length < 12}
          >
            ساخت پشتیبان
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Toggle
          checked={encrypt}
          onChange={setEncrypt}
          label="رمزنگاری پشتیبان"
          description="با AES-256-GCM و کلید مشتق‌شده از عبارت عبور."
        />
        {encrypt && (
          <Field label="عبارت عبور" hint="حداقل ۱۲ نویسه — بدون آن بازگردانی ممکن نیست" required>
            <Input
              ltr
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
        )}
        <Toggle
          checked={includeSecrets}
          onChange={setIncludeSecrets}
          label="گنجاندن اسرار و اعتبارنامه‌ها"
          description={
            isSuperAdmin
              ? 'برای بازگردانی کامل کاربران و مدیران لازم است. فقط مدیر ارشد مجاز است.'
              : 'فقط مدیر ارشد می‌تواند این گزینه را فعال کند.'
          }
        />
        {!includeSecrets && (
          <p className="rounded-xl bg-ink-100 p-3 text-xs leading-6 text-ink-700 dark:bg-ink-950 dark:text-ink-200">
            در پشتیبان بدون اسرار، ستون‌های اعتبارنامه حذف می‌شوند؛ بنابراین جدول‌های کاربران، مدیران
            و اشتراک‌ها هنگام بازگردانی رد خواهند شد (پیکربندی سرورها، مسیریابی و DNS بازگردانی
            می‌شود).
          </p>
        )}
      </div>
    </Modal>
  );
}

function RestoreModal({
  target,
  onClose,
}: {
  target: BackupItem | null;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState('');
  const [wipeExisting, setWipeExisting] = useState(false);

  const restore = useMutation({
    mutationFn: () =>
      api.post<{ report: { restored: Record<string, number>; skipped: { table: string; messageFa: string }[] } }>(
        '/backup/restore',
        {
          key: target?.key,
          ...(passphrase ? { passphrase } : {}),
          wipeExisting,
        },
      ),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries();
      const total = Object.values(data.report.restored).reduce((sum, value) => sum + value, 0);
      toast.success(`${total} رکورد بازگردانی شد.`);
      const skipped = data.report.skipped.filter((item) => item.messageFa.includes('اسرار'));
      if (skipped.length > 0) toast.info(skipped[0].messageFa);
      setPassphrase('');
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'بازگردانی ناموفق بود.'),
  });

  return (
    <Modal
      open={Boolean(target)}
      title="بازگردانی پشتیبان"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="danger" onClick={() => restore.mutate()} loading={restore.isPending}>
            بازگردانی
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          بازگردانی داده‌های فعلی را با محتوای پشتیبان به‌روزرسانی می‌کند. عملیات غیرمخرب است مگر
          گزینهٔ «پاک‌سازی» را فعال کنید.
        </p>
        {target?.encrypted && (
          <Field label="عبارت عبور پشتیبان" required>
            <Input
              ltr
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
        )}
        <Toggle
          checked={wipeExisting}
          onChange={setWipeExisting}
          label="پاک‌سازی داده‌های فعلی پیش از بازگردانی"
          description="خطرناک: همهٔ کاربران و سرورهای فعلی حذف می‌شوند."
        />
      </div>
    </Modal>
  );
}
