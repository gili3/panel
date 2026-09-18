// ELEVEN STORE — استقبال تقارير أخطاء تطبيق الأندرويد (بطلب الأدمن)
import * as functionsV1 from "firebase-functions/v1";
import { logAndroidError } from "../lib/errorLogService";
import { checkRateLimitFirestore } from "../lib/rateLimit";

/**
 * ✅ إضافة: نظير reportError بلوحة التحكم (server/error-log-router.ts)،
 * لكن كـCloud Function بدل tRPC — تطبيق الأندرويد يتصل بـCloud Functions
 * مباشرة (راجع FirestoreRepository.kt: httpsCallable للعمليات المشابهة)،
 * لا بسيرفر Express الخاص باللوحة. النتيجة تُكتب بنفس مجموعة Firestore
 * "systemErrorLogs" التي تقرأها صفحة سجل الأخطاء بلوحة التحكم — مصدر واحد
 * للحقيقة بصرف النظر عن المصدر.
 *
 * بلا context.auth إلزامي عمداً: كراش يمكن أن يحدث لمستخدم غير مسجّل دخول
 * (شاشة الترحيب، تسجيل الدخول نفسه...)، فلا نريد فقدان هذه التقارير تحديداً.
 * الحماية من الإغراق عبر Firestore-based rate limit (متوافق مع أكثر من
 * instance، بخلاف Map بالذاكرة — راجع lib/rateLimit.ts).
 */
export const reportClientError = functionsV1.https.onCall(async (data, context) => {
  const uid = context.auth?.uid ?? null;
  // مفتاح تحديد المعدّل: uid إن وُجد. للمستخدم غير المسجَّل دخول لا يوجد
  // معرّف موثوق متاح هنا (Cloud Functions onCall لا يعرّض عنوان IP كما
  // يفعل Express)، فكل المستخدمين غير المسجَّلين يتشاركون حداً واحداً
  // مجمَّعاً — أقل دقة من مسار اللوحة (IP لكل زائر)، لكنه كافٍ لمنع إغراق
  // حقيقي، وأهم من ذلك: مضمون الترجمة (بلا اعتماد على خاصية لم تُتحقَّق
  // بتعريفات هذا الإصدار من firebase-functions هنا).
  const rateLimitKey = `reportClientError:${uid ?? "anonymous"}`;
  const allowed = await checkRateLimitFirestore(rateLimitKey, 20, 60 * 1000);
  if (!allowed) {
    // فشل صامت عمداً (بلا HttpsError) — نفس مبدأ الطرف الآخر بلوحة التحكم:
    // مسار إبلاغ الأخطاء نفسه لا يجب أن يُنتج خطأً ظاهراً للمستخدم.
    return { success: false };
  }

  const message = typeof data?.message === "string" ? data.message.slice(0, 2000) : "خطأ غير معروف";
  const stack = typeof data?.stack === "string" ? data.stack.slice(0, 8000) : undefined;
  const route = typeof data?.route === "string" ? data.route.slice(0, 300) : undefined;
  const appVersion = typeof data?.appVersion === "string" ? data.appVersion.slice(0, 50) : undefined;
  const deviceInfo = typeof data?.deviceInfo === "string" ? data.deviceInfo.slice(0, 200) : undefined;
  const severity = data?.severity === "fatal" || data?.severity === "warning" ? data.severity : "error";

  await logAndroidError({
    message,
    stack,
    route,
    appVersion,
    deviceInfo,
    severity,
    userId: uid ?? undefined,
    userEmail: context.auth?.token?.email,
  });

  return { success: true };
});
