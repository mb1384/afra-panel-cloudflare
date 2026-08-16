import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
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
  Select,
  Toggle,
} from '../../components/ui';

interface Rule {
  id: string;
  name: string;
  type: string;
  pattern: string;
  action: string;
  priority: number;
  enabled: boolean;
}

const TYPES = [
  { value: 'domain', label: 'دامنهٔ دقیق' },
  { value: 'domain-suffix', label: 'پسوند دامنه' },
  { value: 'domain-keyword', label: 'کلیدواژهٔ دامنه' },
  { value: 'ip', label: 'آدرس IP' },
  { value: 'cidr', label: 'محدودهٔ CIDR' },
  { value: 'geoip', label: 'GeoIP' },
  { value: 'geosite', label: 'GeoSite' },
];

const ACTIONS = [
  { value: 'proxy', label: 'پروکسی', tone: 'blue' as const },
  { value: 'direct', label: 'مستقیم', tone: 'green' as const },
  { value: 'block', label: 'مسدود', tone: 'red' as const },
];

export function RoutingPage(): JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Rule | null>(null);

  const query = useQuery({
    queryKey: ['routing-rules'],
    queryFn: () => api.get<{ items: Rule[]; clashPreview: string[] }>('/routing/rules'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/routing/rules/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['routing-rules'] });
      setPendingDelete(null);
      toast.success('قاعده حذف شد.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'حذف ناموفق بود.'),
  });

  const toggle = useMutation({
    mutationFn: (rule: Rule) => api.patch(`/routing/rules/${rule.id}`, { enabled: !rule.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routing-rules'] }),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'تغییر وضعیت ناموفق بود.'),
  });

  const exportRules = async (): Promise<void> => {
    try {
      const data = await api.get<{ rules: unknown[]; exportedAt: string }>('/routing/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'afra-routing-rules.json';
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('فایل قواعد دانلود شد.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'دریافت فایل ناموفق بود.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="موتور مسیریابی"
        description="قواعد به ترتیب اولویت ارزیابی و در کانفیگ کلاینت‌ها اعمال می‌شوند."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void exportRules()}>
              خروجی
            </Button>
            {can('routing.write') && (
              <>
                <Button
                  variant="secondary"
                  icon={<Upload className="h-4 w-4" />}
                  onClick={() => setImportOpen(true)}
                >
                  ورودی
                </Button>
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                  قاعدهٔ جدید
                </Button>
              </>
            )}
          </>
        }
      >
        {query.isLoading ? (
          <LoadingState />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="قاعده‌ای ثبت نشده است" />
        ) : (
          <div className="table-wrapper">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-ink-200 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
                <tr>
                  <th className="p-2 font-medium">اولویت</th>
                  <th className="p-2 font-medium">نام</th>
                  <th className="p-2 font-medium">نوع</th>
                  <th className="p-2 font-medium">الگو</th>
                  <th className="p-2 font-medium">اقدام</th>
                  <th className="p-2 font-medium">وضعیت</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
                {query.data?.items.map((rule) => {
                  const action = ACTIONS.find((item) => item.value === rule.action);
                  return (
                    <tr key={rule.id}>
                      <td className="p-2 text-xs text-ink-500">{rule.priority}</td>
                      <td className="p-2">{rule.name}</td>
                      <td className="p-2 text-xs text-ink-600 dark:text-ink-300">
                        {TYPES.find((item) => item.value === rule.type)?.label ?? rule.type}
                      </td>
                      <td className="ltr p-2 font-mono text-xs">{rule.pattern}</td>
                      <td className="p-2">
                        <Badge tone={action?.tone ?? 'gray'}>{action?.label ?? rule.action}</Badge>
                      </td>
                      <td className="p-2">
                        <Badge tone={rule.enabled ? 'green' : 'gray'}>
                          {rule.enabled ? 'فعال' : 'غیرفعال'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {can('routing.write') && (
                          <div className="flex gap-1">
                            <Button variant="ghost" onClick={() => toggle.mutate(rule)}>
                              {rule.enabled ? 'غیرفعال' : 'فعال'}
                            </Button>
                            <Button
                              variant="ghost"
                              icon={<Trash2 className="h-4 w-4" />}
                              onClick={() => setPendingDelete(rule)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="پیش‌نمایش قواعد Clash" description="همین خروجی در فایل اشتراک Clash قرار می‌گیرد">
        {(query.data?.clashPreview.length ?? 0) === 0 ? (
          <EmptyState title="پیش‌نمایشی موجود نیست" />
        ) : (
          <pre className="ltr max-h-64 overflow-auto rounded-xl bg-ink-100 p-3 text-xs leading-6 dark:bg-ink-950">
            {query.data?.clashPreview.join('\n')}
          </pre>
        )}
      </SectionCard>

      <RuleFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف قاعده"
        message={`قاعدهٔ «${pendingDelete?.name ?? ''}» حذف شود؟`}
        danger
        confirmLabel="حذف"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}

function RuleFormModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    name: '',
    type: 'domain-suffix',
    pattern: '',
    action: 'proxy',
    priority: '100',
    enabled: true,
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/routing/rules', {
        name: values.name.trim(),
        type: values.type,
        pattern: values.pattern.trim(),
        action: values.action,
        priority: Number(values.priority),
        enabled: values.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['routing-rules'] });
      toast.success('قاعده افزوده شد.');
      setValues({ name: '', type: 'domain-suffix', pattern: '', action: 'proxy', priority: '100', enabled: true });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const details = error.details as { pattern?: string } | undefined;
        toast.error(details?.pattern ?? error.message);
        return;
      }
      toast.error('ذخیره‌سازی ناموفق بود.');
    },
  });

  return (
    <Modal
      open={open}
      title="قاعدهٔ مسیریابی جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            افزودن
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نام قاعده" required>
          <Input
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field label="نوع">
          <Select value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value })}>
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الگو" hint="مثال: example.com یا 10.0.0.0/8" required>
          <Input
            ltr
            value={values.pattern}
            onChange={(event) => setValues({ ...values, pattern: event.target.value })}
          />
        </Field>
        <Field label="اقدام">
          <Select
            value={values.action}
            onChange={(event) => setValues({ ...values, action: event.target.value })}
          >
            {ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="اولویت" hint="عدد کمتر، ارزیابی زودتر">
          <Input
            ltr
            inputMode="numeric"
            value={values.priority}
            onChange={(event) => setValues({ ...values, priority: event.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Toggle
          checked={values.enabled}
          onChange={(value) => setValues({ ...values, enabled: value })}
          label="قاعده فعال باشد"
        />
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);

  const importRules = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(text) as { rules?: unknown[] } | unknown[];
      const rules = Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
      return api.post<{ imported: number }>('/routing/import', { rules, replace });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['routing-rules'] });
      toast.success(`${data.imported} قاعده وارد شد.`);
      setText('');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof SyntaxError) {
        toast.error('فایل JSON نامعتبر است.');
        return;
      }
      toast.error(error instanceof ApiError ? error.message : 'ورود قواعد ناموفق بود.');
    },
  });

  return (
    <Modal
      open={open}
      title="ورود قواعد از JSON"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => importRules.mutate()} loading={importRules.isPending} disabled={!text.trim()}>
            ورود قواعد
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          dir="ltr"
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder='{"rules": [{"name":"...","type":"domain-suffix","pattern":"example.com","action":"proxy","priority":100,"enabled":true}]}'
          className="ltr w-full rounded-xl border border-ink-300 bg-white p-3 font-mono text-xs dark:border-ink-700 dark:bg-ink-950"
        />
        <Toggle
          checked={replace}
          onChange={setReplace}
          label="جایگزینی کامل قواعد فعلی"
          description="در صورت فعال بودن، همهٔ قواعد موجود حذف و قواعد جدید ثبت می‌شوند."
        />
      </div>
    </Modal>
  );
}
