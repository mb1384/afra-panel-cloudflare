import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, fieldErrorsOf } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { SetupStatus } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Badge, Button, CopyField, Field, Input, Select } from '../../components/ui';

const TIMEZONES = [
  'Asia/Tehran',
  'UTC',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Istanbul',
];

const STEPS = [
  'خوش‌آمدید',
  'ایجاد مدیر',
  'منطقهٔ زمانی',
  'دیتابیس',
  'تلگرام',
  'سرور اول',
  'بررسی امنیت',
  'پایان',
];

export function SetupWizard({ status }: { status: SetupStatus }): JSX.Element {
  const { refresh } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    panelName: 'پنل افرا',
    timezone: 'Asia/Tehran',
    edgeUrl: '',
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ recoveryCode: string }>('/setup', {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        panelName: form.panelName.trim(),
        timezone: form.timezone,
        edgeUrl: form.edgeUrl.trim(),
      }),
    onSuccess: (data) => {
      setRecoveryCode(data.recoveryCode);
      setStep(STEPS.length - 1);
      toast.success('راه‌اندازی با موفقیت انجام شد.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'راه‌اندازی ناموفق بود.');
      setStep(1);
    },
  });

  const errors = fieldErrorsOf(submit.error);
  const update = (key: keyof typeof form, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const canContinue = (): boolean => {
    if (step === 1) {
      return form.username.trim().length >= 3 && form.password.length >= 12;
    }
    return true;
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
      <div className="w-full max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-afra-600 text-xl font-bold text-white">
            ا
          </span>
          <div>
            <h1 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
              راه‌اندازی پنل افرا
            </h1>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              گام {step + 1} از {STEPS.length} — {STEPS[step]}
            </p>
          </div>
        </div>

        <div className="mb-4 flex gap-1" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`h-1.5 flex-1 rounded-full ${
                index <= step ? 'bg-afra-600' : 'bg-ink-200 dark:bg-ink-800'
              }`}
            />
          ))}
        </div>

        <div className="card p-5">
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                به پنل افرا خوش آمدید
              </h2>
              <p className="text-sm leading-7 text-ink-600 dark:text-ink-300">
                افرا یک پلتفرم مدیریت پروکسی self-hosted است که کاملاً روی زیرساخت Cloudflare اجرا
                می‌شود: Workers برای پردازش، D1 برای داده، KV برای کش، R2 برای پشتیبان و Durable
                Objects برای هماهنگی. در چند گام کوتاه پنل را آماده می‌کنیم.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">محیط: {status.environment}</Badge>
                <Badge tone="gray">نسخهٔ {status.version}</Badge>
                <Badge tone={status.secretKeyConfigured ? 'green' : 'red'}>
                  کلید رمزنگاری: {status.secretKeyConfigured ? 'تنظیم شده' : 'تنظیم نشده'}
                </Badge>
                <Badge tone={status.cloudflareConfigured ? 'green' : 'amber'}>
                  اتصال Cloudflare: {status.cloudflareConfigured ? 'آماده' : 'بعداً'}
                </Badge>
              </div>
              {!status.secretKeyConfigured && (
                <p className="rounded-xl bg-red-50 p-3 text-xs leading-6 text-red-700 dark:bg-red-950 dark:text-red-300">
                  <ShieldAlert className="ml-1 inline h-4 w-4" />
                  کلید AFRA_SECRET_KEY تنظیم نشده است. قبل از ادامه، آن را با دستور
                  <code className="ltr mx-1">wrangler secret put AFRA_SECRET_KEY</code>
                  تعیین کنید.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field label="نام کاربری مدیر" error={errors.username} required>
                <Input
                  ltr
                  value={form.username}
                  onChange={(event) => update('username', event.target.value)}
                  placeholder="admin"
                />
              </Field>
              <Field label="ایمیل (اختیاری)" error={errors.email}>
                <Input
                  ltr
                  type="email"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                />
              </Field>
              <Field
                label="گذرواژه"
                hint="حداقل ۱۲ نویسه شامل حرف بزرگ، حرف کوچک و رقم"
                error={errors.password}
                required
              >
                <Input
                  ltr
                  type="password"
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                />
              </Field>
              <Field label="نام پنل" error={errors.panelName}>
                <Input
                  value={form.panelName}
                  onChange={(event) => update('panelName', event.target.value)}
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <Field label="منطقهٔ زمانی" hint="برای نمایش تاریخ و زمان‌بندی وظایف">
              <Select value={form.timezone} onChange={(event) => update('timezone', event.target.value)}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3 text-sm leading-7 text-ink-600 dark:text-ink-300">
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">دیتابیس</h2>
              <p>
                افرا از <b>Cloudflare D1</b> استفاده می‌کند و مهاجرت‌ها با Wrangler اعمال می‌شوند.
                اتصال شما در حال حاضر برقرار است — همین صفحه از دیتابیس واقعی خوانده می‌شود.
              </p>
              <code className="ltr rounded-xl bg-ink-100 p-3 text-xs dark:bg-ink-950">
                npm run db:migrate:remote
              </code>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3 text-sm leading-7 text-ink-600 dark:text-ink-300">
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                ربات تلگرام (اختیاری)
              </h2>
              <p>
                این مرحله اختیاری است. بعد از ورود، از بخش «تلگرام» می‌توانید توکن ربات و فهرست
                مدیران مجاز را تنظیم کنید.
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-7 text-ink-600 dark:text-ink-300">
                اگر Worker لبهٔ افرا را مستقر کرده‌اید، آدرس آن را وارد کنید تا لینک‌های اشتراک از آن
                ساخته شوند. در صورت خالی گذاشتن، از دامنهٔ همین پنل استفاده می‌شود.
              </p>
              <Field label="آدرس Worker لبه (اختیاری)" hint="مثال: https://afra-edge.example.workers.dev">
                <Input ltr value={form.edgeUrl} onChange={(event) => update('edgeUrl', event.target.value)} />
              </Field>
            </div>
          )}

          {step === 6 && (
            <ul className="flex flex-col gap-2 text-sm text-ink-700 dark:text-ink-200">
              <SecurityItem ok={status.secretKeyConfigured} label="کلید رمزنگاری اسرار (AFRA_SECRET_KEY)" />
              <SecurityItem ok={form.password.length >= 12} label="گذرواژهٔ قوی مدیر" />
              <SecurityItem ok label="هش گذرواژه با PBKDF2-SHA512 و ۲۱۰٬۰۰۰ تکرار" />
              <SecurityItem ok label="کوکی نشست HttpOnly + SameSite=Strict و محافظت CSRF" />
              <SecurityItem ok label="محدودسازی نرخ ورود و ثبت رویدادها" />
              <SecurityItem ok={status.cloudflareConfigured} label="اعتبارنامهٔ Cloudflare (برای انتشار endpoint)" />
            </ul>
          )}

          {step === 7 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-afra-700 dark:text-afra-400">
                <CheckCircle2 className="h-6 w-6" />
                <h2 className="text-base font-semibold">پنل آمادهٔ استفاده است</h2>
              </div>
              {recoveryCode && (
                <>
                  <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    این کد بازیابی فقط یک‌بار نمایش داده می‌شود. آن را در جای امنی ذخیره کنید؛ با آن
                    می‌توانید در صورت فراموشی گذرواژه دسترسی خود را بازیابی کنید.
                  </p>
                  <CopyField value={recoveryCode} label="کد بازیابی" />
                </>
              )}
              <Button onClick={() => void refresh()} block>
                ورود به داشبورد
              </Button>
            </div>
          )}

          {step < STEPS.length - 1 && (
            <div className="mt-6 flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                disabled={step === 0}
                icon={<ArrowRight className="h-4 w-4" />}
              >
                قبلی
              </Button>

              {step === STEPS.length - 2 ? (
                <Button onClick={() => submit.mutate()} loading={submit.isPending}>
                  تکمیل راه‌اندازی
                </Button>
              ) : (
                <Button
                  onClick={() => setStep((current) => current + 1)}
                  disabled={!canContinue()}
                  icon={<ArrowLeft className="h-4 w-4" />}
                >
                  بعدی
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SecurityItem({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 dark:border-ink-800">
      <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'تأیید' : 'در انتظار'}</Badge>
      <span className="text-sm">{label}</span>
    </li>
  );
}
