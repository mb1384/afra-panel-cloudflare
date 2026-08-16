import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, CopyField, Field, Input, Modal } from '../../components/ui';

export function LoginPage(): JSX.Element {
  const { refresh } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const login = useMutation({
    mutationFn: () =>
      api.post('/auth/login', {
        username: username.trim(),
        password,
        ...(totp ? { totp: totp.trim() } : {}),
      }),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        if (error.code === 'TOTP_REQUIRED') {
          setNeedTotp(true);
          toast.info('کد تأیید دومرحله‌ای را وارد کنید.');
          return;
        }
        toast.error(error.message);
        return;
      }
      toast.error('ورود ناموفق بود.');
    },
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-afra-600 text-2xl font-bold text-white">
            ا
          </span>
          <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50">ورود به پنل افرا</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            مدیریت پروکسی مبتنی بر زیرساخت Cloudflare
          </p>
        </div>

        <form
          className="card flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <Field label="نام کاربری" required>
            <Input
              ltr
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              required
            />
          </Field>

          <Field label="گذرواژه" required>
            <Input
              ltr
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          {needTotp && (
            <Field label="کد تأیید دومرحله‌ای" hint="کد ۶ رقمی برنامهٔ احراز هویت" required>
              <Input
                ltr
                inputMode="numeric"
                maxLength={6}
                value={totp}
                onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
                placeholder="123456"
              />
            </Field>
          )}

          <Button type="submit" loading={login.isPending} icon={<KeyRound className="h-4 w-4" />} block>
            ورود
          </Button>

          <button
            type="button"
            className="text-xs text-afra-700 underline-offset-2 hover:underline dark:text-afra-400"
            onClick={() => setRecoveryOpen(true)}
          >
            گذرواژه را فراموش کرده‌اید؟
          </button>
        </form>
      </div>

      <RecoveryModal open={recoveryOpen} onClose={() => setRecoveryOpen(false)} />
    </div>
  );
}

function RecoveryModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const recover = useMutation({
    mutationFn: () =>
      api.post<{ recovered: boolean; recoveryCode: string }>('/auth/recover', {
        username: username.trim(),
        recoveryCode: recoveryCode.trim(),
        newPassword,
      }),
    onSuccess: (data) => {
      setIssuedCode(data.recoveryCode);
      toast.success('گذرواژه تغییر کرد. با گذرواژهٔ جدید وارد شوید.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'بازیابی ناموفق بود.');
    },
  });

  return (
    <Modal
      open={open}
      title="بازیابی دسترسی"
      onClose={onClose}
      footer={
        issuedCode ? (
          <Button onClick={onClose}>بستن</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              انصراف
            </Button>
            <Button
              onClick={() => recover.mutate()}
              loading={recover.isPending}
              icon={<ShieldCheck className="h-4 w-4" />}
            >
              بازیابی گذرواژه
            </Button>
          </>
        )
      }
    >
      {issuedCode ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-700 dark:text-ink-200">
            کد بازیابی جدید شما (کد قبلی باطل شد). آن را در جای امنی نگه دارید:
          </p>
          <CopyField value={issuedCode} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-ink-600 dark:text-ink-300">
            اگر کد بازیابی (که در پایان راه‌اندازی نمایش داده شد) را دارید، می‌توانید گذرواژه را
            بازنشانی کنید. در غیر این صورت باید از سرور با دستور Wrangler مدیر جدید بسازید — راهنمای
            «بازیابی» در مستندات.
          </p>
          <Field label="نام کاربری" required>
            <Input ltr value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="کد بازیابی" required>
            <Input
              ltr
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="گذرواژهٔ جدید" hint="حداقل ۱۲ نویسه، شامل حرف بزرگ، کوچک و رقم" required>
            <Input
              ltr
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
