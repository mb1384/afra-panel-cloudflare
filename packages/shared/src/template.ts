/** قالب‌های نام‌گذاری Node — مثال: '{FLAG} {COUNTRY} {CITY} {NAME}' */

export interface NodeNameContext {
  name: string;
  country?: string | null;
  city?: string | null;
  flag?: string | null;
  protocol?: string | null;
  index?: number;
  date?: Date;
}

export const TEMPLATE_VARIABLES = [
  '{FLAG}',
  '{COUNTRY}',
  '{CITY}',
  '{NAME}',
  '{DATE}',
  '{INDEX}',
  '{PROTOCOL}',
] as const;

export const DEFAULT_NODE_TEMPLATE = '{FLAG} {COUNTRY} {CITY} {NAME}';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function renderNodeName(template: string, ctx: NodeNameContext): string {
  const values: Record<string, string> = {
    '{FLAG}': ctx.flag ?? (ctx.country ? countryCodeToFlag(ctx.country) : ''),
    '{COUNTRY}': ctx.country ?? '',
    '{CITY}': ctx.city ?? '',
    '{NAME}': ctx.name ?? '',
    '{DATE}': isoDate(ctx.date ?? new Date()),
    '{INDEX}': ctx.index === undefined ? '' : String(ctx.index),
    '{PROTOCOL}': (ctx.protocol ?? '').toUpperCase(),
  };
  const rendered = (template || DEFAULT_NODE_TEMPLATE).replace(
    /\{[A-Z]+\}/g,
    (token) => values[token] ?? token,
  );
  return rendered.replace(/\s{2,}/g, ' ').trim() || ctx.name;
}

/** کد دو حرفی کشور را به پرچم emoji تبدیل می‌کند. */
export function countryCodeToFlag(code: string | null | undefined): string {
  if (!code) return '';
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(
    ...Array.from(cc).map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)),
  );
}
