import * as crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, messaging } from "./admin";

/**
 * ELEVEN STORE — نظام الإشعارات v2 (النواة المشتركة)
 * ═══════════════════════════════════════════════════════════════════════
 * هذا الملف هو المصدر الوحيد لإنشاء أي إشعار في كامل النظام الجديد.
 * لا يُنشئ أي كود آخر (لا العميل، لا السيرفر مباشرة، لا تطبيق الأندرويد)
 * مستنداً في users/{uid}/notifications إطلاقاً — فقط عبر createNotification
 * هنا (أو نسخته المطابقة منطقياً في server/notifications/core.ts للحالات
 * التي تحدث فعلياً على سيرفر Node لا عبر Cloud Functions triggers).
 *
 * القرار المعماري المحوري: "معرّف حتمي + معاملة تتحقق من الوجود أولاً".
 * ───────────────────────────────────────────────────────────────────────
 * كل إشعار له dedupeKey فريد يصف "الحدث" منطقياً، مثال:
 *   order_created:customer:{orderId}
 *   order_status:{orderId}:{status}
 * معرّف المستند نفسه = sha1(dedupeKey) — وليس معرّفاً عشوائياً (auto-id).
 * هذا يعني: أي محاولتين لإنشاء "نفس الإشعار" (إعادة تنفيذ Cloud Function
 * بسبب ضمان "at-least-once" الخاص بها، إعادة محاولة يدوية، خلل شبكي...)
 * تكتبان بالضبط نفس معرّف المستند. المعاملة أدناه تتحقق من عدم وجود
 * المستند قبل الكتابة، فإن كان موجوداً بالفعل تكون العملية no-op تماماً.
 * النتيجة: ضمان "مرة واحدة بالضبط" فعلياً (exactly-once) رغم أن كلاً من
 * Cloud Functions وFCM نفسها لا تضمنان أكثر من "على الأقل مرة" — بدون هذا
 * التصميم، كل عملية إعادة محاولة كانت ستنتج إشعاراً مكرراً.
 */

export type NotificationType = "order" | "shipping" | "promo" | "welcome" | "general";

export interface CreateNotificationInput {
  userId: string;
  /** مفتاح فريد يصف الحدث نفسه — انظر الشرح أعلاه. لا يتغيّر بين محاولات إعادة التنفيذ لنفس الحدث. */
  dedupeKey: string;
  type: NotificationType;
  title: string;
  body: string;
  /** مسار داخلي واحد يُفتح على كلا المنصتين، مثال: "/order/abc123" */
  actionRoute?: string;
  /** رابط صورة اختيارية (إشعارات العروض غالباً) — تُحفظ بالسجل وتُرسل ضمن
   * بيانات FCM لعرضها بـAndroid (BigPictureStyle) وService Worker بالويب. */
  imageUrl?: string;
  entityType?: "order" | "coupon" | null;
  entityId?: string | null;
}

function notificationIdFromDedupeKey(dedupeKey: string): string {
  return crypto.createHash("sha1").update(dedupeKey).digest("hex").slice(0, 32);
}

/**
 * ينشئ سجل الإشعار بشكل idempotent (معرّف حتمي + معاملة تتحقق من الوجود
 * أولاً). لا تلمس notifUnreadCount هنا إطلاقاً — يتكفّل به trigger مستقل،
 * انظر التعليق أسفل المعاملة. تُعيد created:false إن كان هذا الحدث بالذات
 * قد عُولج من قبل — بدون رمي خطأ، فإعادة تنفيذ نفس الحدث يجب أن تبقى آمنة.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<{ id: string; created: boolean }> {
  if (!input.userId) {
    throw new Error("createNotification: userId مفقود");
  }
  const id = notificationIdFromDedupeKey(input.dedupeKey);
  const notifRef = db.collection("users").doc(input.userId).collection("notifications").doc(id);

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(notifRef);
    if (existing.exists) {
      // نفس الحدث وصل مرة أخرى (إعادة تنفيذ Cloud Function، إلخ) — لا شيء نفعله.
      return false;
    }
    tx.set(notifRef, {
      dedupeKey: input.dedupeKey,
      type: input.type,

      title: input.title,
      body: input.body,
      actionRoute: input.actionRoute ?? null,
      imageUrl: input.imageUrl ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      isRead: false,
      readAt: null,
      createdAt: Timestamp.now(),
    });
    // ⚠️ لا نزيد notifUnreadCount هنا يدوياً — تكفّل بذلك حصراً trigger مستقل
    // (triggers/notificationCounterTrigger.ts) يلاحظ إنشاء/تعديل/حذف أي
    // مستند بهذه المجموعة الفرعية، بصرف النظر عن مصدر الكتابة (Admin SDK هنا،
    // أو كتابة عميل مباشرة لاحقاً لتعليم "مقروء" — راجع الشرح المفصّل هناك).
    // توحيد كل تعديل بالعدّاد بمكان واحد بدل تكراره بكل دالة كتابة منفصلة.
    return true;
  });

  return { id, created };
}

// أخطاء FCM التي تعني أن التوكن نفسه تالف بشكل دائم — أي خطأ آخر (عطل
// مؤقت، تجاوز حصة...) يجب ألا يحذف توكناً قد يعود صالحاً بعد لحظات.
const PERMANENT_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

// ✅ إصلاح: أُزيل "https://eleven-sd.com" كقيمة افتراضية مبنية بالكود.
// هذا الرابط يُستخدم فقط لفتح صفحة الإشعار من داخل push للوحة تحكم
// الأدمن (وليس للعملاء) — لكن تثبيت دومين بعينه داخل الكود ممارسة غير
// جيدة بغض النظر عن وجهته الحالية. لو SITE_BASE_URL غير مضبوط في البيئة،
// نرجّع المسار النسبي فقط بدل دومين مفترض؛ اضبط SITE_BASE_URL في
// functions/.env إلى رابط لوحة التحكم الفعلي لو أردت روابط كاملة بالـpush.
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "").replace(/\/$/, "");

function resolveAbsoluteLink(actionRoute?: string | null): string {
  const path = actionRoute && actionRoute.startsWith("/") ? actionRoute : "/notifications";
  return SITE_BASE_URL ? `${SITE_BASE_URL}${path}` : path;
}

/**
 * يرسل Push لكل أجهزة المستخدم المسجَّلة. تُستخدم فقط بعد createNotification
 * الناجحة (created === true) — لا يُرسل Push أبداً لحدث سبق التعامل معه،
 * وإلا كان المستخدم سيتلقى تنبيه Push لإشعار موجود أصلاً بقائمته كل مرة
 * تُعاد فيها محاولة Cloud Function لأي سبب.
 *
 * رسائل "data-only" حصراً (بدون حقل notification أعلى المستوى) — انظر
 * الشرح التاريخي بنفس القرار في server/notifications/core.ts. notificationId
 * يُمرَّر ضمن الـdata ليستخدمه العميل (تطبيق/service worker) كمعرّف عرض
 * ثابت (tag/notify id)، فتُلغي أي إعادة تسليم من FCM نفسها (تحدث أحياناً
 * على مستوى الشبكة) تكرار الإشعار المعروض بدل استبداله بنفسه فقط.
 */
export async function pushToUserDevices(
  userId: string,
  notificationId: string,
  title: string,
  body: string,
  type: NotificationType,
  actionRoute?: string | null,
  imageUrl?: string | null
): Promise<void> {
  const userSnap = await db.collection("users").doc(userId).get();
  const tokens: string[] = userSnap.data()?.fcmTokens || [];
  if (tokens.length === 0) return;

  const message = {
    data: {
      notificationId,
      title,
      body,
      type,
      actionRoute: actionRoute || "",
      imageUrl: imageUrl || "",
    },
    tokens,
    // ⚠️ إصلاح: android.notification كان يحتوي على channelId/tag فقط (بدون
    // عنوان أو نص) — وجود هذا الحقل وحده (حتى بدون notification العلوي)
    // يجعل نظام أندرويد نفسه يصنّف الرسالة كـ"رسالة عرض" وليس "رسالة بيانات"،
    // فيتولى النظام عرضها تلقائياً حين يكون التطبيق بالخلفية/مغلقاً، متجاوزاً
    // onMessageReceived في ElevenFirebaseMessagingService.kt بالكامل — وبما
    // أن هذا الحقل لا يحمل عنواناً ولا نصاً، يظهر إشعار فارغ بلا محتوى. هذا
    // بالضبط سبب "لا يظهر محتوى الإشعار حين يكون التطبيق مغلقاً"، وأحد أسباب
    // التكرار أيضاً (مسار عرض تلقائي من النظام + مسار عرض يدوي من كودنا قد
    // يتزامنان). الحل: رسالة data-only حقيقية بلا أي حقل android.notification
    // إطلاقاً — هذا يضمن استدعاء onMessageReceived دائماً (بالمقدمة والخلفية
    // وحتى إغلاق التطبيق طالما العملية توقظها الأندرويد)، فيبقى كودنا هو
    // المسؤول الوحيد عن بناء وعرض الإشعار بعنوانه ونصه الصحيحين في كل مرة.
    android: {
      priority: "high" as const,
    },
    webpush: {
      headers: { Urgency: "high" },
      fcmOptions: { link: resolveAbsoluteLink(actionRoute) },
    },
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    if (response.failureCount > 0) {
      const deadTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code && PERMANENT_TOKEN_ERROR_CODES.has(resp.error.code)) {
          deadTokens.push(tokens[idx]);
        }
        if (!resp.success) {
          console.error(`[Notifications] فشل تسليم التوكن #${idx}:`, resp.error?.message);
        }
      });
      if (deadTokens.length > 0) {
        await db.collection("users").doc(userId).update({
          fcmTokens: FieldValue.arrayRemove(...deadTokens),
        });
      }
    }
  } catch (error) {
    // لا نرمي — سجل الإشعار مكتوب بالفعل، فشل التسليم الفوري لا يعني فقدانه.
    console.error("[Notifications] تعذّر إرسال الـPush:", error);
  }
}

/** الدالة الموحّدة: إنشاء + إرسال معاً، بترتيب يضمن عدم تكرار الـPush أبداً لحدث معالَج سابقاً. */
export async function notify(input: CreateNotificationInput): Promise<void> {
  const { id, created } = await createNotification(input);
  if (!created) return; // حدث مكرر — تم التعامل معه من قبل، لا Push جديد.
  await pushToUserDevices(input.userId, id, input.title, input.body, input.type, input.actionRoute, input.imageUrl);
}
