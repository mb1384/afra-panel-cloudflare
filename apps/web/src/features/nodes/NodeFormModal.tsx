import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, api, fieldErrorsOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Field, Input, Modal, Select, Toggle } from '../../components/ui';

interface ProtocolMeta {
  key: string;
  labelFa: string;
  supportedTransports: string[];
  requiresTls: boolean;
  edgeRuntimeSupported: boolean;
}

interface NodeMeta {
  protocols: ProtocolMeta[];
  transports: { key: string; labelFa: string }[];
}

interface FormState {
  name: string;
  kind: 'cloudflare-edge' | 'external';
  country: string;
  city: string;
  hostname: string;
  port: string;
  protocol: string;
  transportKind: string;
  path: string;
  host: string;
  serviceName: string;
  tlsMode: 'tls' | 'none';
  sni: string;
  fingerprint: string;
  priority: string;
  weight: string;
  enabled: boolean;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  kind: 'cloudflare-edge',
  country: '',
  city: '',
  hostname: '',
  port: '443',
  protocol: 'vless',
  transportKind: 'ws',
  path: '/afra',
  host: '',
  serviceName: '',
  tlsMode: 'tls',
  sni: '',
  fingerprint: 'chrome',
  priority: '1',
  weight: '50',
  enabled: true,
  notes: '',
};

export function NodeFormModal({
  open,
  nodeId,
  onClose,
}: {
  open: boolean;
  nodeId: string | null;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormState>(EMPTY);
  const editing = Boolean(nodeId);

  const meta = useQuery({
    queryKey: ['node-meta'],
    queryFn: () => api.get<NodeMeta>('/nodes/meta'),
    enabled: open,
  });

  const detail = useQuery({
    queryKey: ['node-detail', nodeId],
    queryFn: () =>
      api.get<{
        node: {
          name: string;
          kind: 'cloudflare-edge' | 'external';
          country: string | null;
          city: string | null;
          hostname: string;
          port: number;
          protocol: string;
          transport: { kind: string; path: string | null; host: string | null; serviceName: string | null };
          tls: { mode: 'tls' | 'none'; sni: string | null; fingerprint: string | null };
          priority: number;
          weight: number;
          enabled: boolean;
          notes: string | null;
        };
      }>(`/nodes/${nodeId}`),
    enabled: open && editing,
  });

  useEffect(() => {
    if (!open) return;
    if (!editing) {
      setValues(EMPTY);
      return;
    }
    const node = detail.data?.node;
    if (!node) return;
    setValues({
      name: node.name,
      kind: node.kind,
      country: node.country ?? '',
      city: node.city ?? '',
      hostname: node.hostname,
      port: String(node.port),
      protocol: node.protocol,
      transportKind: node.transport.kind,
      path: node.transport.path ?? '',
      host: node.transport.host ?? '',
      serviceName: node.transport.serviceName ?? '',
      tlsMode: node.tls.mode,
      sni: node.tls.sni ?? '',
      fingerprint: node.tls.fingerprint ?? 'chrome',
      priority: String(node.priority),
      weight: String(node.weight),
      enabled: node.enabled,
      notes: node.notes ?? '',
    });
  }, [open, editing, detail.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: values.name.trim(),
        kind: values.kind,
        country: values.country.trim().toUpperCase() || null,
        city: values.city.trim() || null,
        hostname: values.hostname.trim(),
        port: Number(values.port),
        protocol: values.protocol,
        transport: {
          kind: values.transportKind,
          path: values.path.trim() || null,
          host: values.host.trim() || null,
          serviceName: values.serviceName.trim() || null,
        },
        tls: {
          mode: values.tlsMode,
          sni: values.sni.trim() || null,
          fingerprint: values.fingerprint || null,
          minVersion: '1.3',
          allowInsecure: false,
        },
        priority: Number(values.priority),
        weight: Number(values.weight),
        enabled: values.enabled,
        notes: values.notes.trim() || null,
      };
      return editing ? api.patch(`/nodes/${nodeId}`, payload) : api.post('/nodes', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      toast.success(editing ? 'سرور به‌روزرسانی شد.' : 'سرور ایجاد شد.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const details = error.details as { issues?: { field: string; message: string }[] } | undefined;
        if (details?.issues?.length) {
          toast.error(details.issues.map((issue) => issue.message).join(' — '));
          return;
        }
        toast.error(error.message);
        return;
      }
      toast.error('ذخیره‌سازی ناموفق بود.');
    },
  });

  const errors = fieldErrorsOf(save.error);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setValues((current) => ({ ...current, [key]: value }));

  const selectedProtocol = meta.data?.protocols.find((item) => item.key === values.protocol);
  const edgeIncompatible = values.kind === 'cloudflare-edge' && selectedProtocol
    ? !selectedProtocol.edgeRuntimeSupported
    : false;

  return (
    <Modal
      open={open}
      title={editing ? 'ویرایش سرور' : 'افزودن سرور'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={edgeIncompatible}>
            {editing ? 'ذخیره تغییرات' : 'افزودن سرور'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="نام سرور" error={errors.name} required>
          <Input value={values.name} onChange={(event) => update('name', event.target.value)} />
        </Field>

        <Field label="نوع سرور" hint="endpoint مدیریت‌شدهٔ Cloudflare یا سرور بیرونی">
          <Select
            value={values.kind}
            onChange={(event) => update('kind', event.target.value as FormState['kind'])}
          >
            <option value="cloudflare-edge">Cloudflare (مدیریت‌شده توسط افرا)</option>
            <option value="external">سرور بیرونی</option>
          </Select>
        </Field>

        <Field label="میزبان (hostname)" error={errors.hostname} required>
          <Input
            ltr
            placeholder="edge.example.com"
            value={values.hostname}
            onChange={(event) => update('hostname', event.target.value)}
          />
        </Field>

        <Field label="پورت" error={errors.port} required>
          <Input
            ltr
            inputMode="numeric"
            value={values.port}
            onChange={(event) => update('port', event.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <Field label="پروتکل">
          <Select value={values.protocol} onChange={(event) => update('protocol', event.target.value)}>
            {(meta.data?.protocols ?? []).map((protocol) => (
              <option key={protocol.key} value={protocol.key}>
                {protocol.labelFa}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Transport">
          <Select
            value={values.transportKind}
            onChange={(event) => update('transportKind', event.target.value)}
          >
            {(selectedProtocol?.supportedTransports ?? ['ws']).map((transport) => (
              <option key={transport} value={transport}>
                {meta.data?.transports.find((item) => item.key === transport)?.labelFa ?? transport}
              </option>
            ))}
          </Select>
        </Field>

        {values.transportKind !== 'grpc' && (
          <Field label="مسیر (path)" hint="مثال: /afra">
            <Input ltr value={values.path} onChange={(event) => update('path', event.target.value)} />
          </Field>
        )}

        {values.transportKind === 'grpc' && (
          <Field label="نام سرویس gRPC" required>
            <Input
              ltr
              value={values.serviceName}
              onChange={(event) => update('serviceName', event.target.value)}
            />
          </Field>
        )}

        <Field label="هدر Host" hint="خالی: برابر hostname">
          <Input ltr value={values.host} onChange={(event) => update('host', event.target.value)} />
        </Field>

        <Field label="TLS">
          <Select
            value={values.tlsMode}
            onChange={(event) => update('tlsMode', event.target.value as FormState['tlsMode'])}
          >
            <option value="tls">فعال (TLS)</option>
            <option value="none">غیرفعال</option>
          </Select>
        </Field>

        <Field label="SNI" hint="خالی: برابر hostname">
          <Input ltr value={values.sni} onChange={(event) => update('sni', event.target.value)} />
        </Field>

        <Field label="Fingerprint">
          <Select
            value={values.fingerprint}
            onChange={(event) => update('fingerprint', event.target.value)}
          >
            {['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="کد کشور" hint="دو حرفی، مثال: DE — پرچم خودکار ساخته می‌شود" error={errors.country}>
          <Input
            ltr
            maxLength={2}
            value={values.country}
            onChange={(event) => update('country', event.target.value.toUpperCase())}
          />
        </Field>

        <Field label="شهر">
          <Input value={values.city} onChange={(event) => update('city', event.target.value)} />
        </Field>

        <Field label="اولویت" hint="عدد کمتر = اولویت بالاتر">
          <Input
            ltr
            inputMode="numeric"
            value={values.priority}
            onChange={(event) => update('priority', event.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <Field label="وزن" hint="برای توازن بار وزنی (۰ تا ۱۰۰۰)">
          <Input
            ltr
            inputMode="numeric"
            value={values.weight}
            onChange={(event) => update('weight', event.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="یادداشت">
            <Input value={values.notes} onChange={(event) => update('notes', event.target.value)} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Toggle
            checked={values.enabled}
            onChange={(value) => update('enabled', value)}
            label="سرور فعال باشد"
            description="سرور غیرفعال در اشتراک کاربران قرار نمی‌گیرد."
          />
        </div>

        {edgeIncompatible && (
          <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <Badge tone="amber">ناسازگار</Badge> پروتکل {selectedProtocol?.labelFa} روی Worker لبهٔ
            افرا اجرا نمی‌شود. برای این پروتکل نوع سرور را «بیرونی» انتخاب کنید. (Worker لبه فقط
            VLESS روی WebSocket را اجرا می‌کند.)
          </p>
        )}
      </div>
    </Modal>
  );
}
