import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate } from '../../lib/format';
import { Badge, Button, CopyField, LoadingState, Modal, StatusBadge } from '../../components/ui';

interface UserDetail {
  user: {
    id: string;
    name: string;
    username: string;
    state: string;
    usedBytes: number;
    quotaBytes: number | null;
    expiresAt: string | null;
    credentialUuid: string;
  };
  subscription: {
    token: string;
    subscriptionUrl: string;
    autoUrl: string;
    base64Url: string;
    clashUrl: string;
    format: string;
    revokedAt: string | null;
    accessCount: number;
    lastAccessAt: string | null;
  } | null;
}

type FormatKey = 'auto' | 'base64' | 'clash';

const FORMAT_LABELS: Record<FormatKey, string> = {
  auto: 'خودکار',
  base64: 'Base64',
  clash: 'Clash',
};

export function SubscriptionModal({
  userId,
  open,
  onClose,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { me } = useAuth();
  const calendar = me?.settings.calendar ?? 'jalali';
  const [format, setFormat] = useState<FormatKey>('auto');
  const [qr, setQr] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['user-detail', userId],
    queryFn: () => api.get<UserDetail>(`/users/${userId}`),
    enabled: open && Boolean(userId),
  });

  const activeUrl = useMemo(() => {
    const subscription = query.data?.subscription;
    if (!subscription) return '';
    if (format === 'base64') return subscription.base64Url;
    if (format === 'clash') return subscription.clashUrl;
    return subscription.autoUrl;
  }, [format, query.data]);

  useEffect(() => {
    if (!activeUrl) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(activeUrl, { width: 320, margin: 1 })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeUrl]);

  return (
    <Modal open={open} title="اشتراک کاربر" onClose={onClose} wide>
      {query.isLoading ? (
        <LoadingState />
      ) : !query.data ? (
        <p className="text-sm text-ink-600 dark:text-ink-300">اطلاعات کاربر یافت نشد.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoCell label="کاربر" value={query.data.user.name} />
            <InfoCell label="وضعیت" value={<StatusBadge state={query.data.user.state} />} />
            <InfoCell
              label="حجم"
              value={`${formatBytes(query.data.user.usedBytes)} / ${formatBytes(query.data.user.quotaBytes)}`}
            />
            <InfoCell label="انقضا" value={formatDate(query.data.user.expiresAt, calendar)} />
          </div>

          {!query.data.subscription ? (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              اشتراکی برای این کاربر ثبت نشده است.
            </p>
          ) : (
            <>
              {query.data.subscription.revokedAt && (
                <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                  این اشتراک لغو شده است و پاسخ نمی‌دهد.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(FORMAT_LABELS) as FormatKey[]).map((key) => (
                  <Button
                    key={key}
                    variant={format === key ? 'primary' : 'secondary'}
                    onClick={() => setFormat(key)}
                  >
                    {FORMAT_LABELS[key]}
                  </Button>
                ))}
                <Badge tone="gray">
                  دفعات دریافت: {query.data.subscription.accessCount}
                </Badge>
                {query.data.subscription.lastAccessAt && (
                  <Badge tone="blue">
                    آخرین دریافت: {formatDate(query.data.subscription.lastAccessAt, calendar, true)}
                  </Badge>
                )}
              </div>

              <CopyField value={activeUrl} label="لینک اشتراک" />

              <div className="flex flex-col items-center gap-3">
                {qr ? (
                  <img
                    src={qr}
                    alt="کد QR اشتراک"
                    className="h-56 w-56 max-w-full rounded-xl border border-ink-200 bg-white p-2 dark:border-ink-800"
                  />
                ) : (
                  <p className="text-xs text-ink-500">کد QR در دسترس نیست.</p>
                )}
                <p className="text-center text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                  این لینک یک اعتبارنامه است؛ آن را در جای عمومی منتشر نکنید.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
      <p className="text-[11px] text-ink-500 dark:text-ink-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-ink-900 dark:text-ink-50">{value}</p>
    </div>
  );
}
