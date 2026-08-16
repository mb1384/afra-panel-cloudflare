const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * کد بازیابی خوانا (بدون نویسه‌های مبهم) در قالب XXXX-XXXX-XXXX-XXXX.
 * فقط hash آن ذخیره می‌شود و یک‌بار به مدیر نمایش داده می‌شود.
 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = '';
  for (const byte of bytes) raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return (raw.match(/.{1,4}/g) ?? [raw]).join('-');
}
