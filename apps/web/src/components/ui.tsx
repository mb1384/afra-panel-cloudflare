import clsx from 'clsx';
import { AlertCircle, Check, Copy, Inbox, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { copyToClipboard } from '../lib/format';

/* --------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-afra-600 text-white hover:bg-afra-700 active:bg-afra-800 disabled:bg-afra-300 dark:disabled:bg-afra-900',
  secondary:
    'border border-ink-300 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800',
  ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
};

export function Button({
  variant = 'primary',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- Fields --------------------------------- */

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, error, hint, required, children }: FieldProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-700 dark:text-ink-200">
        {label}
        {required && <span className="mr-1 text-red-500">*</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-ink-500 dark:text-ink-400">{hint}</span>}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

const CONTROL_CLASS =
  'w-full rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 transition focus:border-afra-500 disabled:bg-ink-100 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50 dark:disabled:bg-ink-900';

export function Input({
  className,
  ltr,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ltr?: boolean }): JSX.Element {
  return <input {...rest} className={clsx(CONTROL_CLASS, ltr && 'ltr font-mono', className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select {...rest} className={clsx(CONTROL_CLASS, 'pl-2', className)}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{label}</p>
        {description && <p className="text-xs text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-afra-600' : 'bg-ink-300 dark:bg-ink-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'right-0.5' : 'right-[1.375rem]',
          )}
        />
      </button>
    </div>
  );
}

/* --------------------------------- Badges --------------------------------- */

export type BadgeTone = 'green' | 'red' | 'amber' | 'gray' | 'blue';

const TONES: Record<BadgeTone, string> = {
  green: 'bg-afra-100 text-afra-800 dark:bg-afra-950 dark:text-afra-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  gray: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
};

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const USER_STATE_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: 'green', label: 'فعال' },
  disabled: { tone: 'gray', label: 'غیرفعال' },
  expired: { tone: 'red', label: 'منقضی‌شده' },
  exhausted: { tone: 'amber', label: 'حجم تمام‌شده' },
};

export function StatusBadge({ state }: { state: string }): JSX.Element {
  const config = USER_STATE_TONES[state] ?? { tone: 'gray' as BadgeTone, label: state };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

const HEALTH_TONES: Record<string, { tone: BadgeTone; label: string; dot: string }> = {
  healthy: { tone: 'green', label: 'سالم', dot: 'bg-afra-500' },
  degraded: { tone: 'amber', label: 'کند', dot: 'bg-amber-500' },
  unreachable: { tone: 'red', label: 'خارج از دسترس', dot: 'bg-red-500' },
  disabled: { tone: 'gray', label: 'غیرفعال', dot: 'bg-ink-400' },
  unknown: { tone: 'gray', label: 'بررسی‌نشده', dot: 'bg-ink-400' },
};

export function NodeHealthIndicator({
  health,
  latencyMs,
}: {
  health: string;
  latencyMs?: number | null;
}): JSX.Element {
  const config = HEALTH_TONES[health] ?? HEALTH_TONES.unknown;
  return (
    <Badge tone={config.tone}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
      {latencyMs !== null && latencyMs !== undefined && (
        <span className="ltr text-[11px] opacity-80">{latencyMs}ms</span>
      )}
    </Badge>
  );
}

/* --------------------------------- States --------------------------------- */

export function LoadingState({ label = 'در حال بارگذاری…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-ink-500 dark:text-ink-400">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="max-w-sm text-sm text-ink-700 dark:text-ink-200">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          تلاش دوباره
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <Inbox className="h-8 w-8 text-ink-400" />
      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {action}
    </div>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-ink-900 sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label="بستن"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-200 px-5 py-4 dark:border-ink-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأیید',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            انصراف
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-700 dark:text-ink-200">{message}</p>
    </Modal>
  );
}

/* -------------------------------- Copy field ------------------------------- */

export function CopyField({ value, label }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-sm font-medium text-ink-700 dark:text-ink-200">{label}</span>}
      <div className="flex items-stretch gap-2">
        <code className="ltr flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs text-ink-800 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-200">
          {value}
        </code>
        <Button
          variant="secondary"
          icon={copied ? <Check className="h-4 w-4 text-afra-600" /> : <Copy className="h-4 w-4" />}
          onClick={async () => {
            const ok = await copyToClipboard(value);
            setCopied(ok);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'کپی شد' : 'کپی'}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------- Pagination ------------------------------- */

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}): JSX.Element | null {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-3">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        قبلی
      </Button>
      <span className="text-xs text-ink-500 dark:text-ink-400">
        صفحهٔ {page} از {pageCount}
      </span>
      <Button variant="secondary" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        بعدی
      </Button>
    </div>
  );
}

/* --------------------------------- StatCard -------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'gray',
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: BadgeTone;
}): JSX.Element {
  return (
    <div className="card flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-xs text-ink-500 dark:text-ink-400">{label}</p>
        <p className="mt-1 text-xl font-semibold text-ink-900 dark:text-ink-50">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
      </div>
      {icon && (
        <span className={clsx('rounded-xl p-2', TONES[tone])} aria-hidden="true">
          {icon}
        </span>
      )}
    </div>
  );
}

/* ------------------------------- Section card ------------------------------ */

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-ink-200 px-4 py-4 dark:border-ink-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
