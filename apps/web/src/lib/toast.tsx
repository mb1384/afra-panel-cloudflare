import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-afra-600 dark:text-afra-400" />,
  error: <TriangleAlert className="h-5 w-5 text-red-600 dark:text-red-400" />,
  info: <Info className="h-5 w-5 text-sky-600 dark:text-sky-400" />,
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 4000);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"
          >
            {ICONS[item.kind]}
            <p className="flex-1 text-sm leading-6 text-ink-800 dark:text-ink-100">{item.message}</p>
            <button
              type="button"
              onClick={() => remove(item.id)}
              className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
              aria-label="بستن پیام"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast باید داخل ToastProvider استفاده شود.');
  return context;
}
