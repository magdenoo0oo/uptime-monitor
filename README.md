# Uptime Monitor

[![ci](https://github.com/magdenoo0oo/uptime-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/magdenoo0oo/uptime-monitor/actions/workflows/ci.yml) [![collect](https://github.com/magdenoo0oo/uptime-monitor/actions/workflows/collect.yml/badge.svg)](data/STATUS.md)

باك إند لمراقبة المواقع.
اليوزر بيضيف لينكات، و worker في الخلفية بيفحصها كل كام دقيقة.
لو موقع وقع بيفتح incident ويبعت إيميل، ولما يرجع بيقفل الـ incident ويبعت إيميل تاني.

**Node.js + Express 5 + MongoDB (Mongoose) + Agenda + Nodemailer**، من غير Redis ولا أي infrastructure زيادة.

## التشغيل

```bash
cp .env.example .env      # واكتب JWT_ACCESS_SECRET طويل وعشوائي
npm install
npm run dev               # API + worker على http://localhost:4100
```

محتاج MongoDB **7.0 أو أحدث** (عشان `$percentile`).

| الأمر | بيعمل إيه |
|---|---|
| `npm run dev` | الـ API والـ worker في process واحدة، وبيعمل restart لوحده مع أي تعديل |
| `npm run worker` | worker لوحده (فحوصات وإيميلات) من غير HTTP |
| `npm test` | 52 test (MongoDB في الذاكرة، وموقع وهمي، و SMTP وهمي) |
| `npm run demo` | والسيرفر شغال: بيمثّل موقع بيقع ويرجع، وبيعرض كل اللي الـ API بيقوله |

**التوثيق التفاعلي:** http://localhost:4100/docs (Swagger). اعمل login، ودوس **Authorize** وحط الـ `accessToken`.

**الإيميلات:** لو `SMTP_URL` فاضي، الإيميلات بتتسجل في الـ log بدل ما تتبعت، فتقدر تجرب كل حاجة من غير SMTP.
عشان تشوفها كإيميلات حقيقية من غير ما تبعت لحد، اعمل inbox مجاني على [Mailtrap](https://mailtrap.io) وحط الـ SMTP URL بتاعه.

## داتا حقيقية: مواقع مصرية لايف

غير الـ API، المشروع بيراقب **17 موقع مصري عام** (بنوك، حكومة، اتصالات، أخبار) من GitHub Actions، والنتايج بتتسجل في الـ repo نفسه:

**⬅ [data/STATUS.md](data/STATUS.md): الحالة دلوقتي، ونسبة الـ uptime في آخر 24 ساعة و 7 أيام و 30 يوم، والأعطال.**

- **`collect.yml`:** بيشتغل 20–30 مرة في اليوم في أوقات مختلفة. نفس تصميم egypt-pulse: الـ planner في `scripts/plan.mjs` بيعمل خطة ثابتة لكل يوم، والـ workflow بيلحق الفحوصات اللي فاتته لو GitHub وقّف الـ cron، وبيرجّع نفسه لو اتوقف.
- **`scripts/collect.js`:** بيستخدم نفس `probeWithRetries` بتاع الـ API، يعني نفس الـ retries بالـ backoff ونفس حماية SSRF. ومنطق الحسابات كله في `src/collector/state.js` ومتغطي بـ tests.
- **الملفات اللي بتطلع:** `latest.json`، و `daily/<date>.json`، و `incidents.json`، و `summary.json`، و `STATUS.md`.
- **تعريف "up":** السيرفر رد بأي status أقل من 500 في خلال 15 ثانية. الـ 403 من حماية البوتات معناها إن السيرفر شغال.
- **حدود القياس:** الفحص بيتعمل من runners بره مصر، فالمواقع اللي بتمنع الطلبات من بره (زي البورصة) مش في القايمة.

تضيف موقع؟ زوّده في `data/targets.json`. وعدد الفحوصات في اليوم بيتظبط من repo variables: `PLAN_MIN` و `PLAN_MAX`.

## هيكل المشروع

```
src/
  server.js              API (ومعاه الـ worker لو RUN_WORKER=true)
  worker.js              worker لوحده
  app.js                 Express: helmet, cors, logging, Swagger, routes
  config/                env (متعمله validation بـ Zod)، الداتابيز، الـ logger
  models/                User, Monitor, Check (time-series), Incident, Alert, RefreshToken
  checks/
    probe.js             طلب HTTP واحد + retries بـ exponential backoff
    safeNetwork.js       حماية SSRF (منع العناوين الداخلية)
    backoff.js           exponential backoff + jitter
    runCheck.js          الفحص الكامل وتغيّر الحالة (up/down) والـ incidents
  jobs/
    index.js             تعريف الـ jobs في Agenda (الفحص والإيميل) والـ retry policy
    scheduler.js         job لكل monitor + الـ reconcile عند التشغيل
  alerts/                صف الإيميلات، وتسليمها، والـ templates، والـ mailer
  modules/
    auth/ users/         التسجيل والـ tokens والإعدادات
    monitors/            CRUD، والإحصائيات، والسجل
    status/              صفحة الحالة العامة
  collector/state.js     منطق الداتا اليومية (latest, daily, incidents, STATUS.md)
  docs/openapi.js        Swagger spec (الـ request schemas متولدة من Zod)
data/                    نتايج مراقبة المواقع المصرية (بيكتبها collect.yml)
scripts/
  collect.js             جولة فحص واحدة على data/targets.json
  plan.mjs               خطة الفحوصات اليومية (20–30 في اليوم)
  demo.js                ديمو كامل في الـ terminal
tests/                   52 test
```

## إزاي بيشتغل

```
POST /monitors ──► Monitor + Agenda job (repeatEvery N minutes, أول تشغيل فوراً)
                              │
              worker ◄────────┘  (بيدوّر على الـ jobs اللي جه وقتها كل JOBS_PROCESS_EVERY_MS)
                │
                ▼
           probe(url) ── فشل؟ ── retry بعد ~2s، وبعدين ~4s (exponential + jitter)
                │
                ▼
     Check ──► time-series collection (بتتمسح لوحدها بعد 90 يوم)
                │
                ▼
     applyResult: up→down  ──► Incident (open)     ──► Alert + job "send-alert"
                  down→up  ──► Incident (resolved) ──► Alert + job "send-alert"
                                                              │
                                     SMTP فشل؟ Agenda بتعيد بـ exponential backoff
                                     (30s، 1m، 2m، 4m، 8m) وبعدين status=failed
```

## REST API

كل الـ endpoints تحت `/api/v1`. اللي عليه 🔒 محتاج `Authorization: Bearer <accessToken>`.

| Method | Path | الوصف |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` → tokens جديدة (القديم بيتلغي) |
| POST | `/auth/logout` | `{ refreshToken }` |
| GET 🔒 | `/users/me` | بياناتي |
| PATCH 🔒 | `/users/me` | `{ name?, alertsEnabled?, statusPageSlug? }` |
| GET 🔒 | `/monitors` | كل الـ monitors بتوعي بالحالة ونسبة الـ uptime في آخر 24 ساعة |
| POST 🔒 | `/monitors` | `{ name, url, method?, intervalMinutes?, timeoutMs?, acceptedStatus?, keyword?, public? }` |
| GET 🔒 | `/monitors/:id` | monitor واحد |
| PATCH 🔒 | `/monitors/:id` | تعديل، أو `{ paused: true/false }` للإيقاف والتشغيل |
| DELETE 🔒 | `/monitors/:id` | بيمسح الـ monitor وكل سجله والـ job بتاعته |
| POST 🔒 | `/monitors/:id/check` | فحص حقيقي دلوقتي: بيتحفظ وممكن يفتح incident ويبعت إيميل |
| POST 🔒 | `/monitors/:id/test` | فحص تجريبي: ما بيحفظش حاجة وما بيبعتش إيميلات |
| GET 🔒 | `/monitors/:id/stats?period=24h` | الـ uptime %، و avg/p50/p95/p99، والـ downtime (`24h` `7d` `30d` `90d`) |
| GET 🔒 | `/monitors/:id/response-times?period=7d&bucket=6h` | بيانات للرسوم البيانية |
| GET 🔒 | `/monitors/:id/checks?limit=50&cursor=` | سجل الفحوصات، الأحدث الأول |
| GET 🔒 | `/monitors/:id/incidents` | الأعطال، ومع كل عطل الإيميلات اللي اتبعتت |
| GET | `/status/:slug` | صفحة الحالة العامة (من غير تسجيل دخول) |

## قرارات التصميم (وليه)

**Agenda بدل cron أو setInterval.**
- الـ jobs متخزنة في MongoDB، فلو السيرفر وقع ورجع ما بيضيعش أي schedule.
- كل job بتتعمل لها lock، فتقدر تشغّل كذا worker (`npm run worker`) من غير ما فحص يتعمل مرتين.
- `setInterval` بيضيع كل حاجة مع أي restart، ومش بيشتغل غير على process واحدة.

**job لكل monitor بـ `unique({ 'data.monitorId' })`.**
`agenda.every()` بيسمح بـ job واحدة بس لكل اسم، فمينفعش هنا.
مع `unique`، لو حفظت الـ job تاني بعد ما غيّرت الـ interval بتتحدث بدل ما تتكرر.
ولما الـ worker يقوم بيعمل reconcile بـ `insertOnly`: يضيف الـ jobs الناقصة، ويمسح jobs الـ monitors اللي اتمسحت، ومن غير ما يأخر ميعاد الـ jobs الموجودة.

**نوعين retry، كل واحد في مكانه.**
- **الفحص:** الـ retries بتحصل جوه الـ job نفسها (2s ثم 4s ±20%) قبل ما نعلن إن الموقع وقع، عشان packet واحدة ضاعت ما تصحّيش حد الساعة 3 الفجر.
  ولو الموقع واقع أصلاً، بنعمل محاولة واحدة بس، لأننا مستنيين يرجع مش بنأكد إنه وقع.
- **الإيميل:** بيستخدم الـ `exponential` backoff الجاهز في Agenda كـ job منفصلة. فلو SMTP بطيء أو واقع عمره ما بيأخر الفحوصات، والتنبيه مش بيضيع.
- **الـ jitter (±20%):** من غيره، 1000 monitor على نفس السيرفر الواقع هيعملوا retry في نفس اللحظة بالظبط.

**Time-series collection للفحوصات.**
MongoDB بتجمع قياسات نفس الـ monitor في buckets مضغوطة مترتبة بالوقت.
ده بيوفر مساحة كبيرة على الهارد، وبيخلي queries زي "متوسط زمن الاستجابة كل ساعة" سريعة.
والبيانات القديمة بتتمسح لوحدها بـ `expireAfterSeconds`.
الإحصائيات بتستخدم `$dateTrunc` للتجميع و `$percentile` لحساب p95.

**مستحيل يبقى في incident مفتوح مرتين.**
في unique index على `monitor` بس للـ incidents المفتوحة (`partialFilterExpression: { isOpen: true }`).
فلو فحصين اشتغلوا في نفس الوقت، الداتابيز بتقبل incident واحد وإيميل واحد.

**Optimistic concurrency بـ `revision`.**
لو عدّلت الـ URL والفحص لسه شغال، النتيجة بتاعت الإعدادات القديمة بتترمي.
استخدمنا عدّاد مش `updatedAt` لأن تعديلين في نفس الملّي ثانية بياخدوا نفس الـ timestamp. الـ test بتاع ده كشف المشكلة دي فعلاً.

**حماية من SSRF.**
اليوزر بيدّينا URL والسيرفر بتاعنا هو اللي بيفتحه، فمن غير حماية ممكن حد يضيف `http://localhost:27017` أو `http://169.254.169.254` (بيانات الـ cloud) ويستكشف الشبكة الداخلية.
الحماية بتحصل وقت الاتصال جوه الـ DNS lookup، فبتمنع كمان DNS rebinding.
الـ IPs المكتوبة مباشرة بتتمنع، حتى لو متشفّرة زي `0x7f000001`.
والـ redirects مش بتتّتبع، وده متعمّد.

**الأمان.**
- الـ HTML بتاع الإيميل بيعمل escape لأي محتوى من اليوزر.
- الـ logs ما بتسجلش الـ Authorization header.
- monitor بتاع حد تاني بيرجع 404 مش 403.
- صفحة الحالة العامة ما بتظهرش الـ URLs.
- refresh token rotation بيكشف لو token اتسرق.

## الحدود الحالية وخطوات تالية

- **قنوات تنبيه تانية:** Slack، و Telegram، و webhooks (تتضاف كـ `channel` جديد في `Alert`).
- **Rollups يومية** للإحصائيات الطويلة (90 يوم) بدل ما نعمل aggregation على كل الفحوصات.
- **فحص من أكتر من منطقة** عشان نتأكد إن العطل حقيقي مش مشكلة في شبكتنا.
- **SSL expiry:** تنبيه قبل ما شهادة الموقع تخلص.
- **Docker** و docker-compose (API + worker + Mongo).
