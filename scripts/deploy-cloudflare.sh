#!/usr/bin/env bash
# ============================================================
# پنل افرا — اسکریپت استقرار خودکار روی Cloudflare
#
# این اسکریپت idempotent است: اجرای دوباره منابع موجود را
# دوباره نمی‌سازد و فقط کد را به‌روزرسانی می‌کند.
#
# پیش‌نیازها:
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export CLOUDFLARE_API_TOKEN=...   (با مجوزهای زیر)
#
#   Account · Workers Scripts    · Edit
#   Account · Workers KV Storage · Edit
#   Account · D1                 · Edit
#   Account · Workers R2 Storage · Edit   (برای پشتیبان‌گیری)
#
# استفاده:
#   bash scripts/deploy-cloudflare.sh [production|staging]
# ============================================================
set -euo pipefail

ENVIRONMENT="${1:-production}"
API="https://api.cloudflare.com/client/v4"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$ENVIRONMENT" in
  production) SUFFIX="production" ;;
  staging)    SUFFIX="staging" ;;
  *) echo "محیط نامعتبر: $ENVIRONMENT (فقط production یا staging)"; exit 1 ;;
esac

D1_NAME="afra-db-${SUFFIX}"
KV_TITLE="afra-kv-${SUFFIX}"
R2_NAME="afra-backups-${SUFFIX}"

log()  { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

cf() { # cf METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "${API}${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" --data "$body"
  else
    curl -sS -X "$method" "${API}${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
  fi
}

# ------------------------------------------------------------
# ۰) بررسی پیش‌نیازها
# ------------------------------------------------------------
log "بررسی پیش‌نیازها"
: "${CLOUDFLARE_ACCOUNT_ID:?متغیر CLOUDFLARE_ACCOUNT_ID تنظیم نشده است}"
: "${CLOUDFLARE_API_TOKEN:?متغیر CLOUDFLARE_API_TOKEN تنظیم نشده است}"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js نسخهٔ ۲۲ یا بالاتر لازم است (نسخهٔ فعلی: $(node -v))"

TOKEN_OK="$(cf GET /user/tokens/verify | python3 -c "import sys,json;print(json.load(sys.stdin).get('success'))")"
[ "$TOKEN_OK" = "True" ] || die "توکن Cloudflare نامعتبر است"

for probe in "d1/database:D1" "storage/kv/namespaces:Workers KV" ; do
  ep="${probe%%:*}"; label="${probe##*:}"
  ok="$(cf GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/${ep}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('success'))")"
  [ "$ok" = "True" ] || die "توکن مجوز «${label}» را ندارد. راهنمای مجوزها در بالای همین فایل."
done
echo "توکن معتبر است و مجوزهای لازم را دارد."

# ------------------------------------------------------------
# ۱) ساخت (یا یافتن) منابع Cloudflare
# ------------------------------------------------------------
log "آماده‌سازی دیتابیس D1: ${D1_NAME}"
D1_ID="$(cf GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database?name=${D1_NAME}" \
  | python3 -c "
import sys,json
rows=json.load(sys.stdin).get('result') or []
print(next((r['uuid'] for r in rows if r.get('name')=='${D1_NAME}'), ''))")"

if [ -z "$D1_ID" ]; then
  D1_ID="$(cf POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" "{\"name\":\"${D1_NAME}\"}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('result') or {}).get('uuid',''))")"
  [ -n "$D1_ID" ] || die "ساخت دیتابیس D1 ناموفق بود"
  echo "دیتابیس ساخته شد."
else
  echo "دیتابیس موجود بود؛ استفاده می‌شود."
fi

log "آماده‌سازی فضای KV: ${KV_TITLE}"
KV_ID="$(cf GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" \
  | python3 -c "
import sys,json
rows=json.load(sys.stdin).get('result') or []
print(next((r['id'] for r in rows if r.get('title')=='${KV_TITLE}'), ''))")"

if [ -z "$KV_ID" ]; then
  KV_ID="$(cf POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces" "{\"title\":\"${KV_TITLE}\"}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('result') or {}).get('id',''))")"
  [ -n "$KV_ID" ] || die "ساخت فضای KV ناموفق بود"
  echo "فضای KV ساخته شد."
else
  echo "فضای KV موجود بود؛ استفاده می‌شود."
fi

log "آماده‌سازی سطل R2: ${R2_NAME} (اختیاری)"
R2_READY=false
if cf GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets" | grep -q '"success":true'; then
  cf POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets" "{\"name\":\"${R2_NAME}\"}" >/dev/null || true
  R2_READY=true
  echo "سطل R2 آماده است."
else
  warn "توکن مجوز R2 ندارد؛ پشتیبان‌گیری درون‌برنامه‌ای غیرفعال می‌ماند (بقیهٔ پنل کار می‌کند)."
fi

# ------------------------------------------------------------
# ۲) ساخت پیکربندی محلی (این فایل‌ها در .gitignore هستند)
# ------------------------------------------------------------
log "ساخت پیکربندی محلی wrangler با شناسه‌های واقعی"
python3 - "$ROOT" "$SUFFIX" "$D1_ID" "$KV_ID" "$R2_READY" <<'PY'
import pathlib, sys, re
root, suffix, d1_id, kv_id, r2_ready = sys.argv[1:6]
for app in ("control-plane", "edge"):
    src = pathlib.Path(root, "apps", app, "wrangler.jsonc")
    text = src.read_text(encoding="utf-8")
    text = text.replace(f"REPLACE_ME_D1_{suffix.upper()}", d1_id)
    text = text.replace(f"REPLACE_ME_KV_{suffix.upper()}", kv_id)
    if r2_ready != "true":
        # حذف اتصال R2 در صورت نبود مجوز
        text = re.sub(r'\n\s*"r2_buckets": \[[^\]]*\],', '', text)
    dst = pathlib.Path(root, "apps", app, "wrangler.local.jsonc")
    dst.write_text(text, encoding="utf-8")
    print(f"  {dst.relative_to(root)}")
PY

# ------------------------------------------------------------
# ۳) مهاجرت‌های دیتابیس
# ------------------------------------------------------------
log "اعمال مهاجرت‌های D1 روی ${D1_NAME}"
cd "${ROOT}/apps/control-plane"
npx wrangler d1 migrations apply "$D1_NAME" -c wrangler.local.jsonc --env "$ENVIRONMENT" --remote

# ------------------------------------------------------------
# ۴) ساخت رابط کاربری
# ------------------------------------------------------------
log "ساخت رابط کاربری"
cd "$ROOT"
npm run build

# ------------------------------------------------------------
# ۵) استقرار Control Plane
# ------------------------------------------------------------
log "استقرار Control Plane"
cd "${ROOT}/apps/control-plane"
CP_OUT="$(npx wrangler deploy -c wrangler.local.jsonc --env "$ENVIRONMENT" 2>&1)"
echo "$CP_OUT" | grep -viE "telemetry" || true
CP_URL="$(echo "$CP_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"

# ------------------------------------------------------------
# ۶) کلید رمزنگاری اسرار (پس از ساخت Worker)
# ------------------------------------------------------------
log "بررسی کلید AFRA_SECRET_KEY"
cd "${ROOT}/apps/control-plane"
if npx wrangler secret list -c wrangler.local.jsonc --env "$ENVIRONMENT" 2>/dev/null | grep -q "AFRA_SECRET_KEY"; then
  echo "کلید از قبل تنظیم شده است؛ تغییری داده نمی‌شود."
else
  if [ -n "${AFRA_SECRET_KEY:-}" ]; then
    GENERATED_KEY="$AFRA_SECRET_KEY"
    echo "از مقدار متغیر محیطی AFRA_SECRET_KEY استفاده می‌شود."
  else
    GENERATED_KEY="$(openssl rand -base64 48 | tr -d '\n')"
    printf '%s' "$GENERATED_KEY" > "${ROOT}/AFRA_SECRET_KEY.txt"
    chmod 600 "${ROOT}/AFRA_SECRET_KEY.txt"
    warn "کلید جدید تولید و در فایل AFRA_SECRET_KEY.txt ذخیره شد."
    warn "آن را در مدیر گذرواژه ذخیره و سپس فایل را حذف کنید (این فایل در .gitignore است)."
  fi
  printf '%s' "$GENERATED_KEY" | npx wrangler secret put AFRA_SECRET_KEY -c wrangler.local.jsonc --env "$ENVIRONMENT"
fi

log "استقرار Edge Worker"
cd "${ROOT}/apps/edge"
EDGE_OUT="$(npx wrangler deploy -c wrangler.local.jsonc --env "$ENVIRONMENT" 2>&1)"
echo "$EDGE_OUT" | grep -viE "telemetry" || true
EDGE_URL="$(echo "$EDGE_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"

# ------------------------------------------------------------
# ۷) راستی‌آزمایی
# ------------------------------------------------------------
log "راستی‌آزمایی سرویس‌ها"
sleep 4
for pair in "پنل:${CP_URL}" "لبه:${EDGE_URL}"; do
  label="${pair%%:*}"; url="${pair#*:}"
  [ -n "$url" ] || { warn "آدرس ${label} استخراج نشد."; continue; }
  for path in health ready; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${url}/${path}" || echo 000)"
    printf '  %s /%s → HTTP %s\n' "$label" "$path" "$code"
  done
done

cat <<EOF

============================================================
✅ استقرار «${ENVIRONMENT}» کامل شد

  پنل مدیریت : ${CP_URL:-—}
  Worker لبه : ${EDGE_URL:-—}
  دیتابیس    : ${D1_NAME}
  فضای KV    : ${KV_TITLE}
  پشتیبان R2 : $([ "$R2_READY" = true ] && echo "${R2_NAME}" || echo "غیرفعال (مجوز R2 لازم است)")

گام بعدی:
  ۱) آدرس پنل را در مرورگر باز کنید و جادوگر راه‌اندازی را کامل نمایید.
  ۲) در گام «سرور اول»، آدرس Worker لبه را وارد کنید: ${EDGE_URL:-—}
  ۳) کد بازیابی نمایش‌داده‌شده را در جای امنی ذخیره کنید.
============================================================
EOF
