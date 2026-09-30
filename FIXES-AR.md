# ملخص الإصلاحات

## ترتيب النشر (مهم جداً)
`deploy-functions.yml` ينشر الدوال **والقواعد معاً** عند أي push. النسخ القديمة من التطبيق تكتب الطلب مباشرة، وستفشل فور نشر القواعد الجديدة. لذلك:

1. **ادفع كود `panel` أولاً بدون تغيير `firestore.rules`** (أو انشر الدوال فقط: `firebase deploy --only functions,firestore:indexes`). هذا ينشر `placeOrder` و`submitContactMessage` وسياسات الـTTL.
2. **أصدر نسخة الأندرويد الجديدة** (تستدعي الدالتين بدل الكتابة المباشرة) وانتظر انتشارها.
3. **ثم انشر `firestore.rules`** (تقفل الكتابة المباشرة نهائياً).

## ما تم إصلاحه
| # | الإصلاح | الملفات |
|---|---|---|
| 1، 2 | إنشاء الطلب صار على السيرفر داخل transaction واحدة (مخزون + كوبون + عدّاد + الطلب). القواعد ترفض الكتابة المباشرة على الطلبات/المخزون/العدّاد/الكوبونات | `functions/src/callables/placeOrder.ts`، `firestore.rules`، `FirestoreRepository.kt` |
| 3 | `createOrder`/`createDirectOrder` بالسيرفر: مستند الطلب يُكتب داخل نفس الـtransaction، وتفريغ السلة أفضل جهد | `server/firestore-router.ts` |
| 4 | الكمية عدد صحيح 1–999، وعدد الأسطر حتى 30 (السيرفر والسلة والـCallable) | `server/firestore-router.ts` |
| 5 | الـRate limit يأخذ عنوان البروكسي الموثوق (hop=1) افتراضياً في الإنتاج | `server/_core/rateLimit.ts` |
| 6 | مسار Bearer يتحقق من إلغاء التوكن | `server/_core/context.ts` |
| 7 | رسائل التواصل عبر Callable بحد لكل IP ولكل مرسِل، والقواعد تمنع الكتابة المباشرة | `functions/src/callables/contactMessage.ts` |
| 8 | App Check: مزوّد Debug لنسخ debug وPlay Integrity لـrelease، وخيار `ENFORCE_APP_CHECK=true` للدوال الجديدة (اختياري) | `src/debug`، `src/release`، `build.gradle` |
| 9 | Dockerfile يثبّت بالـlockfile إن وُجد، ويعمل بمستخدم غير root، وCI على Node 22 | `Dockerfile`، workflows |
| 11 | TTL على `_rateLimits` و`passwordResetOtps` | `firestore.indexes.json`، `functions/src/lib/rateLimit.ts` |
| +1 | منع تكرار الطلب: التطبيق يرسل `requestId` ثابتاً لإعادة محاولة نفس الطلب، والسيرفر يُرجع الطلب الأول بدل إنشاء ثانٍ (معرّف الطلب = requestId) | `placeOrder.ts`، `FirestoreRepository.kt` |
| +2 | مزامنة مخزون Algolia بعد الطلب من الدالة (اختيارية؛ تحتاج `ALGOLIA_APP_ID` و`ALGOLIA_ADMIN_API_KEY` في `functions/.env`) | `functions/src/lib/algolia.ts` |
| +3 | التحقق من تأكيد البريد يرجع لسجل Auth الحي إن كان التوكن قديماً | `placeOrder.ts` |
| — | اختبار يضمن تطابق منطق التسعير بين السيرفر والدوال، واختبارات قواعد محدّثة، واختبار وحدة للأندرويد وخطوة تشغيله في CI | `tests/functions/order-pricing-parity.test.ts`، `tests/rules/...`، `ModelsTest.kt` |

## يحتاج إجراءً منك
- **مفتاح Resend**: كان ضمن الـzip، فدوّره من لوحة Resend وضع الجديد في `functions/.env`.
- **`OWNER_OPEN_ID` مكرر بقيمتين** في `functions/.env`: احذف الخاطئة (لم ألمس ملفات `.env`).
- **App Check Enforce**: يُفعَّل من Firebase Console بعد مراقبة نسبة Verified 24–48 ساعة.
- **Algolia للدوال**: أضف `ALGOLIA_APP_ID` و`ALGOLIA_ADMIN_API_KEY` (و`ALGOLIA_PRODUCTS_INDEX` إن اختلف) إلى `functions/.env` لتعمل المزامنة، وإلا تُتجاهل بصمت.
- **`pnpm-lock.yaml`**: لا أستطيع توليده دون إنترنت؛ سيرفعه CI تلقائياً عند أول تشغيل، وبعدها يلتزم به الـDockerfile.

## لم أنفّذه، وسبب ذلك
- **تقسيم الملفات الضخمة وتنظيف `any`** (`AdminDashboard.tsx` وغيره): لا يمكنني بناء المشروع أو تشغيل اختباراته هنا، وإعادة هيكلة بهذا الحجم دون تحقق تخاطر بكسر شيء. الأفضل تنفيذها على دفعات مع تشغيل CI.
- **التطويرات** (بوابة دفع، WebP، إلخ): مسار تطوير وليست إصلاحات.

## سلوك تغيّر
- لم يعد هناك حد 10 عناصر للسلة (كان من قواعد Firestore).
- الطلب من الأندرويد يحتاج اتصالاً بالدالة، وأخطاء المخزون والكوبون تصل بنفس رسائلها العربية.

## مؤجَّل
- `minInstances` لتقليل البدء البارد، وفحص حد أدنى لإصدار التطبيق (Remote Config)، و`runBlocking` في `ElevenFirebaseMessagingService`، ودمج مساري إنشاء الطلب (tRPC والـCallable) في مصدر واحد.

## دفعة لاحقة
- سجل الأخطاء: TTL بعد 90 يوماً (`systemErrorLogs.expireAt`)، والأندرويد لا يبلّغ عن رفض السيرفر المتوقع (مخزون/كوبون/اتصال).

## نشر Firebase من CI
- **النشر ينتظر الاختبارات:** job `verify` (vitest + قواعد Firebase) يجب أن ينجح قبل job `deploy`.
- **`functions/.env` من سر:** أنشئ سراً في GitHub باسم `FUNCTIONS_ENV` (Settings ← Secrets and variables ← Actions ← New repository secret) وألصق فيه محتوى `functions/.env` كاملاً، سطراً لكل متغير، بدون تكرار `OWNER_OPEN_ID`. بدونه تُنشر الدوال بلا `RESEND_API_KEY` ولا تُرسَل إيميلات OTP/التأكيد.

## ترويسات الأمان
- `server/_core/securityHeaders.ts`: `nosniff` ومنع التضمين بـiframe و`Referrer-Policy` و`Permissions-Policy` و`HSTS` بالإنتاج. لم أضف COOP (يكسر تسجيل دخول Google المنبثق) ولا CSP (تحتاج جرد نطاقات أولاً).
- job `verify` صار يبني `functions` أيضاً للتحقق من الأنواع قبل النشر.

## App Check
- بما أن App Check مفعّل: سجّل رمز Debug لنسخ debug من سجل Logcat (وسم `DebugAppCheckProvider`) في Firebase Console ← App Check ← Manage debug tokens، وإلا ترفض الخدمات طلبات نسخ التطوير.
- بعد التأكد أن طلبات الدوال تظهر Verified في لوحة App Check، أضف `ENFORCE_APP_CHECK=true` إلى سر `FUNCTIONS_ENV` لتُرفض طلبات `placeOrder` و`submitContactMessage` بلا رمز صالح.
- لوحة الويب: إن فعّلت Enforce على Firestore/Storage فلا بد من مفتاح reCAPTCHA في إعدادات اللوحة وإلا تفشل قراءاتها.
- شاشة الدفع تعرض الآن المجموع الفرعي والخصم والشحن قبل الإجمالي.
