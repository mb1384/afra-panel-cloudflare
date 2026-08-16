import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, api, fieldErrorsOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Field, Input, Modal, Select, Toggle } from '../../components/ui';

export interface UserFormValues {
  name: string;
  username: string;
  description: string;
  quota: string;
  dailyQuota: string;
  expiresInDays: string;
  enabled: boolean;
  tags: string;
  nodeIds: string[];
  subscriptionFormat: 'auto' | 'base64' | 'clash';
}

const EMPTY: UserFormValues = {
  name: '',
  username: '',
  description: '',
  quota: '',
  dailyQuota: '',
  expiresInDays: '30',
  enabled: true,
  tags: '',
  nodeIds: [],
  subscriptionFormat: 'auto',
};

interface NodeOption {
  id: string;
  name: string;
  health: string;
}

export function UserFormModal({
  open,
  userId,
  onClose,
  onCreated,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onCreated?: (userId: string) => void;
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<UserFormValues>(EMPTY);
  const editing = Boolean(userId);

  const nodes = useQuery({
    queryKey: ['node-options'],
    queryFn: () => api.get<{ items: NodeOption[] }>('/nodes?pageSize=200'),
    enabled: open,
  });

  const detail = useQuery({
    queryKey: ['user-detail', userId],
    queryFn: () =>
      api.get<{
        user: {
          name: string;
          username: string;
          description: string | null;
          quotaBytes: number | null;
          dailyQuotaBytes: number | null;
          enabled: boolean;
          tags: string[];
          nodeIds: string[];
          expiresAt: string | null;
        };
        subscription: { format: string } | null;
      }>(`/users/${userId}`),
    enabled: open && editing,
  });

  useEffect(() => {
    if (!open) return;
    if (!editing) {
      setValues(EMPTY);
      return;
    }
    const data = detail.data;
    if (!data) return;
    const remainingDays = data.user.expiresAt
      ? Math.max(0, Math.ceil((Date.parse(data.user.expiresAt) - Date.now()) / 86_400_000))
      : 0;
    setValues({
      name: data.user.name,
      username: data.user.username,
      description: data.user.description ?? '',
      quota: data.user.quotaBytes ? `${Math.round(data.user.quotaBytes / 1024 ** 3)}GB` : '',
      dailyQuota: data.user.dailyQuotaBytes
        ? `${Math.round(data.user.dailyQuotaBytes / 1024 ** 3)}GB`
        : '',
      expiresInDays: String(remainingDays),
      enabled: data.user.enabled,
      tags: data.user.tags.join(', '),
      nodeIds: data.user.nodeIds,
      subscriptionFormat: (data.subscription?.format as UserFormValues['subscriptionFormat']) ?? 'auto',
    });
  }, [open, editing, detail.data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: values.name.trim(),
        username: values.username.trim(),
        description: values.description.trim() || null,
        quota: values.quota.trim() || null,
        dailyQuota: values.dailyQuota.trim() || null,
        expiresInDays: values.expiresInDays === '' ? null : Number(values.expiresInDays),
        enabled: values.enabled,
        tags: values.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        nodeIds: values.nodeIds,
        subscriptionFormat: values.subscriptionFormat,
      };
      if (editing) {
        return api.patch<{ user: { id: string } }>(`/users/${userId}`, payload);
      }
      return api.post<{ user: { id: string } }>('/users', payload);
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      toast.success(editing ? 'کاربر به‌روزرسانی شد.' : 'کاربر ایجاد شد.');
      onClose();
      if (!editing && onCreated) onCreated(data.user.id);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'ذخیره‌سازی ناموفق بود.');
    },
  });

  const errors = fieldErrorsOf(save.error);
  const update = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]): void =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      open={open}
      title={editing ? 'ویرایش کاربر' : 'ایجاد کاربر'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {editing ? 'ذخیره تغییرات' : 'ایجاد کاربر'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="نام نمایشی" error={errors.name} required>
          <Input value={values.name} onChange={(event) => update('name', event.target.value)} />
        </Field>

        <Field label="نام کاربری" error={errors.username} hint="حروف لاتین، رقم، نقطه و خط تیره" required>
          <Input
            ltr
            value={values.username}
            onChange={(event) => update('username', event.target.value)}
          />
        </Field>

        <Field label="حجم کل" hint="مثال: 50GB — خالی برای نامحدود" error={errors.quota}>
          <Input ltr value={values.quota} onChange={(event) => update('quota', event.target.value)} />
        </Field>

        <Field label="حجم روزانه" hint="اختیاری، مثال: 2GB" error={errors.dailyQuota}>
          <Input
            ltr
            value={values.dailyQuota}
            onChange={(event) => update('dailyQuota', event.target.value)}
          />
        </Field>

        <Field label="مدت اعتبار (روز)" hint="صفر یا خالی: بدون انقضا" error={errors.expiresInDays}>
          <Input
            ltr
            inputMode="numeric"
            value={values.expiresInDays}
            onChange={(event) => update('expiresInDays', event.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <Field label="فرمت پیش‌فرض اشتراک">
          <Select
            value={values.subscriptionFormat}
            onChange={(event) =>
              update('subscriptionFormat', event.target.value as UserFormValues['subscriptionFormat'])
            }
          >
            <option value="auto">خودکار (تشخیص از کلاینت)</option>
            <option value="base64">Base64</option>
            <option value="clash">Clash / Mihomo</option>
          </Select>
        </Field>

        <Field label="برچسب‌ها" hint="با کاما جدا کنید">
          <Input value={values.tags} onChange={(event) => update('tags', event.target.value)} />
        </Field>

        <Field label="توضیحات">
          <Input
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="سرورهای مجاز" hint="اگر هیچ سروری انتخاب نشود، همهٔ سرورهای فعال در اشتراک قرار می‌گیرند">
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl border border-ink-300 p-2 dark:border-ink-700">
              {(nodes.data?.items.length ?? 0) === 0 ? (
                <p className="p-2 text-xs text-ink-500">سروری ثبت نشده است.</p>
              ) : (
                nodes.data?.items.map((node) => (
                  <label
                    key={node.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-afra-600"
                      checked={values.nodeIds.includes(node.id)}
                      onChange={(event) =>
                        update(
                          'nodeIds',
                          event.target.checked
                            ? [...values.nodeIds, node.id]
                            : values.nodeIds.filter((id) => id !== node.id),
                        )
                      }
                    />
                    <span className="truncate">{node.name}</span>
                  </label>
                ))
              )}
            </div>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Toggle
            checked={values.enabled}
            onChange={(value) => update('enabled', value)}
            label="کاربر فعال باشد"
            description="کاربر غیرفعال نمی‌تواند اشتراک دریافت کند یا متصل شود."
          />
        </div>
      </div>
    </Modal>
  );
}
