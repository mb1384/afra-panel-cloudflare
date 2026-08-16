# ارتقا و بازگشت (Rollback)

---

## ارتقا به نسخهٔ جدید

```bash
# ۱) دریافت کد جدید
git pull

# ۲) نصب وابستگی‌های احتمالی جدید
npm install

# ۳) اطمینان از سلامت پیش از استقرار
npm run typecheck
npm test

# ۴) اعمال مهاجرت‌های جدید دیتابیس
npm run db:migrate:remote

# ۵) ساخت و استقرار
npm run build
npm run deploy
```

> 💡 **پیش از هر ارتقا پشتیبان بگیرید** (بخش پشتیبان‌گیری در پنل یا `wrangler d1 export`).

### ترتیب مهم

مهاجرت‌های دیتابیس **قبل** از استقرار کد جدید اعمال می‌شوند تا کد جدید با طرح تازه سازگار باشد.
مهاجرت‌ها افزایشی و نسخه‌دار هستند و هرگز طرح تولیدی را به‌صورت دستی تغییر نمی‌دهند.

---

## بازگشت به نسخهٔ قبلی

### بازگشت Worker

```bash
cd apps/control-plane
npx wrangler rollback
```

یا از داشبورد Cloudflare: **Workers & Pages → afra-control-plane → Deployments → Rollback**.

### بازگشت دیتابیس

مهاجرت‌های D1 به‌صورت خودکار برنمی‌گردند. اگر نسخهٔ جدید مهاجرتی اعمال کرده که با نسخهٔ قدیمی
ناسازگار است، از پشتیبانِ پیش از ارتقا بازگردانی کنید:

```bash
npx wrangler d1 execute afra-db --remote --file=afra-backup-before-upgrade.sql
```

---

## محیط‌ها

برای کاهش ریسک، ابتدا روی **staging** ارتقا دهید و پس از اطمینان به **production** بروید:

```bash
npm run deploy:staging -w @afra/control-plane
# بررسی...
npm run deploy:production -w @afra/control-plane
```
