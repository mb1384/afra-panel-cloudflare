# پنل افرا — معماری پیشنهادی

## ۱. نمای کلی

Afra Panel یک پلتفرم مدیریت پروکسی self-hosted است که از صفر و مستقل پیاده‌سازی می‌شود. معماری به‌صورت ماژولار و لایه‌ای طراحی شده تا UI هیچ‌گاه به منطق شبکه وابسته نشود.

### پشتهٔ فناوری (Tech Stack)

| لایه | انتخاب | دلیل |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS | سرعت توسعه، RTL-friendly، موبایل‌محور |
| Backend | Node.js 20 + TypeScript (strict) + Fastify | تایپ قوی، سریع، پلاگین‌محور، سبک برای VPS |
| ORM | Prisma | مهاجرت‌های امن، تایپ‌محور، پشتیبانی SQLite و PostgreSQL |
| دیتابیس | SQLite (پیش‌فرض) / PostgreSQL (اختیاری) | سادگی self-host + مقیاس‌پذیری |
| Auth | Session + Argon2id + TOTP (اختیاری) | امنیت مدرن |
| صف/Job | BullMQ + Redis (اختیاری) یا صف داخلی سبک | health check و jobهای پس‌زمینه |
| Telegram | grammY | ربات اختیاری |
| تست | Vitest + Playwright | واحد، یکپارچگی، E2E |
| استقرار | Docker + Docker Compose | VPS و لوکال |

---

## ۲. معماری لایه‌ای

```
┌─────────────────────────────────────────────┐
│  Admin Dashboard (React SPA — RTL Persian)  │
└──────────────┬──────────────────────────────┘
               │ REST /api/v1 + WebSocket
┌──────────────▼──────────────────────────────┐
│           API Layer (Fastify)               │
│  Auth middleware · RBAC · Validation (Zod)  │
├─────────────────────────────────────────────┤
│           Service Layer (Business Logic)    │
│  UserService · SubscriptionService · ...    │
├─────────────────────────────────────────────┤
│           Adapter Layer (Plugin System)     │
│  ProtocolAdapter · NodeAdapter ·            │
│  DnsProviderAdapter · BackendAdapter ·      │
│  NotificationAdapter · SubFormatAdapter     │
├─────────────────────────────────────────────┤
│  Data Layer (Prisma)  │  Background Workers │
│  SQLite / PostgreSQL  │  Health · Traffic   │
└─────────────────────────────────────────────┘
```

### اصل کلیدی: Adapter/Plugin
هر زیرسیستم قابل‌توسعه یک interface مشترک دارد:

```ts
interface ProtocolAdapter {
  readonly key: string;              // 'vless' | 'trojan' | 'shadowsocks'
  validate(config: unknown): ValidationResult;
  generateClientConfig(node: Node, user: User): ClientConfig;
  generateSubscriptionEntry(node: Node, user: User): string;
  getMetadata(): ProtocolMetadata;
  testConnection(node: Node): Promise<HealthResult>;
}

interface NodeAdapter { /* انواع Node بدون بازنویسی هسته */ }
interface SubFormatAdapter { /* auto | base64 | clash | آینده: sing-box */ }
interface NotificationAdapter { send(event: NotificationEvent): Promise<void>; }
```

ثبت adapterها در یک Registry مرکزی انجام می‌شود؛ افزودن پروتکل جدید = یک فایل جدید + ثبت در registry.

---

## ۳. ساختار پوشه‌ها (Monorepo ساده)

```
afra-panel/
├── apps/
│   ├── server/                  # Fastify API
│   │   ├── src/
│   │   │   ├── modules/         # یک پوشه per ماژول (auth, users, nodes, ...)
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── auth.schemas.ts      # Zod
│   │   │   │   │   └── auth.test.ts
│   │   │   │   ├── users/
│   │   │   │   ├── subscriptions/
│   │   │   │   ├── nodes/
│   │   │   │   ├── protocols/
│   │   │   │   ├── routing/
│   │   │   │   ├── dns/
│   │   │   │   ├── chains/
│   │   │   │   ├── warp/
│   │   │   │   ├── backends/
│   │   │   │   ├── telegram/
│   │   │   │   ├── notifications/
│   │   │   │   ├── analytics/
│   │   │   │   ├── audit/
│   │   │   │   ├── backup/
│   │   │   │   └── settings/
│   │   │   ├── adapters/        # پیاده‌سازی Protocol/Node/DNS/... adapters
│   │   │   ├── core/            # registry, event bus, scheduler, crypto
│   │   │   ├── plugins/         # fastify plugins (auth, rbac, rate-limit)
│   │   │   ├── lib/             # db client, logger, config
│   │   │   └── server.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── web/                     # React SPA
│       ├── src/
│       │   ├── components/      # Modal, Drawer, DataTable, UserCard, ...
│       │   ├── features/        # users/, nodes/, dashboard/, settings/
│       │   ├── layouts/         # AdminLayout (RTL), SetupWizard
│       │   ├── lib/             # api client, i18n, utils
│       │   ├── locales/         # fa.json, en.json, ru.json
│       │   └── App.tsx
├── packages/
│   └── shared/                  # تایپ‌ها و اسکیماهای مشترک server/web
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── docs/
```

---

## ۴. طراحی دیتابیس (Schema)

```prisma
// خلاصهٔ موجودیت‌های اصلی (نسخهٔ کامل در Milestone 1)

model Admin {
  id            String   @id @default(cuid())
  username      String   @unique
  email         String?  @unique
  passwordHash  String   // Argon2id — هرگز plaintext نه
  totpSecret    String?  // رمزنگاری‌شده at rest
  roleId        String
  role          Role     @relation(fields: [roleId])
  sessions      Session[]
  createdAt     DateTime @default(now())
}

model Role {
  id          String @id @default(cuid())
  name        String @unique   // super_admin | admin | read_only
  permissions Permission[]
}

model Permission {
  id     String @id @default(cuid())
  key    String @unique        // users.read, nodes.write, ...
  roles  Role[]
}

model Session {
  id         String   @id @default(cuid())
  adminId    String
  token      String   @unique  // hashed
  ip         String?
  userAgent  String?
  expiresAt  DateTime
  createdAt  DateTime @default(now())
}

model User {
  id               String    @id @default(cuid())
  name             String
  username         String    @unique
  description      String?
  uuid             String    // credential
  enabled          Boolean   @default(true)
  quotaBytes       BigInt?   // سقف کل؛ null = نامحدود
  dailyQuotaBytes  BigInt?
  usedBytes        BigInt    @default(0)
  expiresAt        DateTime?
  lastActivityAt   DateTime?
  tags             String[]  // یا جدول Tag جدا
  subscription     Subscription?
  nodes            UserNode[]
  createdAt        DateTime  @default(now())
  @@index([enabled, expiresAt])
  @@index([username])
}

model Subscription {
  id          String   @id @default(cuid())
  userId      String   @unique
  token       String   @unique  // random 32-byte, hash در لاگ
  format      String   @default("auto")
  revokedAt   DateTime?
  rotatedAt   DateTime?
  createdAt   DateTime @default(now())
}

model Node {
  id          String   @id @default(cuid())
  name        String
  country     String?
  city        String?
  flag        String?
  hostname    String
  ip          String?
  port        Int
  protocol    String   // vless | trojan | shadowsocks
  transport   String   // ws | grpc | xhttp
  tlsConfig   Json?    // sni, alpn, fingerprint, version
  priority    Int      @default(1)
  weight      Int      @default(50)
  enabled     Boolean  @default(true)
  health      String   @default("unknown") // healthy|degraded|unreachable|disabled
  latencyMs   Int?
  lastCheckAt DateTime?
  notes       String?
  createdAt   DateTime @default(now())
  @@index([enabled, health, priority])
}

model RoutingRule {
  id       String  @id @default(cuid())
  name     String
  type     String  // domain | ip | cidr | geoip | geosite
  pattern  String
  action   String  // direct | proxy | block
  priority Int
  enabled  Boolean @default(true)
}

model DnsServer {
  id       String  @id @default(cuid())
  name     String
  type     String  // udp | doh | dot
  address  String
  isPrimary Boolean @default(false)
  enabled  Boolean @default(true)
  health   String  @default("unknown")
}

model ProxyChain {
  id     String @id @default(cuid())
  name   String
  hops   Json   // آرایهٔ مرتب [{type:'node',id} | {type:'socks5',...}]
  enabled Boolean @default(true)
}

model Backend {
  id        String  @id @default(cuid())
  name      String
  url       String
  secretEnc String  // رمزنگاری‌شده at rest
  enabled   Boolean @default(true)
  health    String  @default("unknown")
}

model TelegramAdmin {
  id           String @id @default(cuid())
  telegramId   String @unique
  role         String // admin | read_only
  createdAt    DateTime @default(now())
}

model Notification {
  id        String   @id @default(cuid())
  type      String
  title     String
  body      String
  readAt    DateTime?
  createdAt DateTime @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  adminId    String?
  action     String   // user.created, node.deleted, ...
  resource   String?
  resourceId String?
  result     String   // success | failure
  ip         String?
  metadata   Json?    // بدون هیچ secret
  createdAt  DateTime @default(now())
  @@index([action, createdAt])
}

model SystemSetting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}

model Backup {
  id        String   @id @default(cuid())
  path      String
  encrypted Boolean
  sizeBytes BigInt
  createdAt DateTime @default(now())
}

model TrafficSample {  // برای نمودارها — تجمیع دوره‌ای
  id        String   @id @default(cuid())
  userId    String?
  nodeId    String?
  bytes     BigInt
  bucketAt  DateTime // دقیقه/ساعت
  @@index([bucketAt])
}
```

نکته‌ها: همهٔ جستجوهای پرتکرار ایندکس دارند؛ `BigInt` برای بایت‌ها؛ secrets فقط رمزنگاری‌شده (AES-256-GCM با کلید از env) ذخیره می‌شوند.

---

## ۵. طراحی API (نسخه‌بندی‌شده)

پایه: `/api/v1` — پاسخ یکدست:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "USER_NOT_FOUND", "message": "کاربر یافت نشد." } }
```

| گروه | Endpointها |
|---|---|
| Auth | `POST /auth/login` `POST /auth/logout` `GET /auth/me` `POST /auth/totp/enable|verify` |
| Users | `GET /users` (search/filter/sort/paginate) `POST /users` `GET/PATCH/DELETE /users/:id` `POST /users/:id/reset-traffic` `POST /users/:id/rotate-credentials` `POST /users/:id/rotate-token` `GET /users/:id/qr` |
| Subscriptions | `GET /sub/:token` (عمومی، خروجی auto/base64/clash) `POST /subscriptions/:id/revoke` |
| Nodes | CRUD کامل + `POST /nodes/:id/check` `POST /nodes/check-all` |
| Health | `GET /health` `GET /ready` (عمومی، بدون auth) |
| Routing | CRUD `/routing/rules` + import/export |
| DNS | CRUD `/dns/servers` + `POST /dns/servers/:id/check` |
| Chains | CRUD `/proxy-chains` + `POST /proxy-chains/:id/validate` |
| Backends | CRUD `/backends` + health |
| Telegram | `GET/PATCH /telegram/settings` `GET/POST/DELETE /telegram/admins` |
| Analytics | `GET /analytics/overview` `GET /analytics/traffic?range=` |
| Audit | `GET /audit` (filter/search) |
| Backup | `POST /backup` `GET /backup` `POST /backup/:id/restore` |
| Settings | `GET/PATCH /settings` |

WebSocket: `/ws` برای رویدادهای زنده (وضعیت nodeها، اعلان‌ها).

---

## ۶. مدل امنیتی

1. **احراز هویت**: Argon2id (memory-hard)، session با کوکی `HttpOnly; Secure; SameSite=Strict`، انقضای قابل‌تنظیم، TOTP اختیاری.
2. **محافظت brute-force**: rate limit روی `/auth/login` (مثلاً ۵ تلاش/۵ دقیقه per IP+username) + قفل موقت.
3. **RBAC**: سه نقش پیش‌فرض + permissionهای دانه‌ای (`users.read` و...)؛ middleware بررسی permission روی هر route.
4. **ورودی**: اعتبارسنجی Zod در همهٔ routeها؛ خروجی Prisma پارامتریزه (ضد SQLi)؛ CSP + XSS headers؛ CSRF token برای mutationها.
5. **اسرار**: AES-256-GCM at rest برای TOTP secret، backend secret، bot token؛ کلید از `AFRA_SECRET_KEY` در env. چرخش کلید پشتیبانی می‌شود.
6. **لاگ**: هرگز لاگ نشود: password، token اشتراک، UUID (جز ضروری)، bot token، backend secret. Audit log برای همهٔ اکشن‌های مدیریتی.
7. **اشتراک**: token تصادفی ۲۵۶‌بیت؛ URL اشتراک = credential؛ در لاگ‌ها mask می‌شود؛ rotation و revoke.
8. **شبکه مسئولانه**: health check فقط روی nodeهای پیکربندی‌شده؛ بدون اسکن عمومی.

---

## ۷. معماری UI

- **RTL کامل** با فونت Vazirmatn، اعداد فارسی در متن و لاتین برای مقادیر فنی (UUID/IP/URL با `dir="ltr"`).
- **تاریخ**: Jalali (جلالی) پیش‌فرض با گزینهٔ میلادی — کتابخانهٔ `jalaali-js`.
- **i18n**: ساختار آماده برای fa/en/ru؛ پیش‌فرض fa.
- **موبایل‌محور**: جدول کاربران در دسکتاپ → کارت در موبایل؛ bottom-sheet به‌جای modal در موبایل؛ اکشن‌های رایج زیر ۳ کلیک.
- **تم**: روشن/تیره/سیستم.
- **کامپوننت‌ها**: Modal, Drawer, DataTable, UserCard, NodeCard, StatusBadge, TrafficChart, ConfirmDialog, Toast, QRCodeModal, SubscriptionModal, NodeHealthIndicator, EmptyState, LoadingState, ErrorState.
- **Setup Wizard** هشت‌مرحله‌ای فارسی در اولین اجرا.

---

## ۸. ریسک‌ها و tradeoffها

| ریسک | تصمیم |
|---|---|
| شمارش ترافیک واقعی نیازمند اتصال به core پروکسی (xray/sing-box) است | Backend Adapter generic می‌سازیم؛ شمارش از طریق API بک‌اند/آمار node؛ بدون وابستگی به یک core خاص |
| SQLite و jobهای سنگین هم‌زمان | صف داخلی سبک پیش‌فرض؛ Redis/BullMQ اختیاری برای مقیاس |
| پیچیدگی تولید Clash config | SubFormatAdapter با snapshot test |
| WARP | ماژول کاملاً اختیاری و غیرفعال پیش‌فرض |
| Cloudflare | فقط یک DNS provider اختیاری، نه وابستگی |

---

## ۹. نقشهٔ راه (Milestones)

1. **M1** — اسکلت monorepo، Prisma+SQLite، Auth (Argon2id+session+rate limit)، Setup Wizard، شِل داشبورد RTL
2. **M2** — Users CRUD + Subscriptions (auto/base64/clash) + QR + جدول/کارت ریسپانسیو
3. **M3** — Nodes + Health worker + وضعیت‌ها + نمودار
4. **M4** — Protocol adapters (VLESS/Trojan/SS × WS/gRPC/XHTTP) + تولید کانفیگ ترکیبی
5. **M5** — Routing engine + DNS engine + فیلترینگ دامنه
6. **M6** — Proxy chains + Backend adapter + WARP (اختیاری)
7. **M7** — Telegram bot (فارسی، allowlist، audit)
8. **M8** — Analytics + Audit UI + Backup/Restore رمزنگاری‌شده
9. **M9** — سخت‌سازی امنیتی (headers, CSRF, rotation, review)
10. **M10** — تست کامل + Docker + مستندات استقرار
