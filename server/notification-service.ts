import { adminDb } from "./firebase-admin";
import admin from "firebase-admin";
import * as crypto from "crypto";
import type { NotificationType } from "../shared/types";

/**
 * ELEVEN STORE — نظام الإشعارات v2 (النواة العامة على سيرفر Node)
 * ─────────────────────────────────────────────────────────
 * ⚠️ منذ إعادة البناء v2: إشعارات الطلبات (استلام الطلب / تحديث الحالة)
 * لم تعد تمر من هنا إطلاقاً — انتقلت بالكامل إلى Cloud Functions triggers
 * (functions/src/triggers/orderTriggers.ts) التي تلاحظ orders/{orderId}
 * مباشرة، لتوحيد المسار بين الموقع وتطبيق الأندرويد (راجع الشرح المفصّل
 * هناك). هذا الملف الآن مخصَّص فقط لأي إشعار "عام" يُطلقه السيرفر مباشرة
 * خارج سياق الطلبات — مثال: رسالة ترحيب بعد التسجيل، إشعار عرض ترويجي
 * يُرسله الأدمن يدوياً، تنبيه أمني بحساب المستخدم، إلخ.
 *
 * القرارات المعمارية (مطابقة تماماً لنواة Cloud Functions حرفاً بحرف —
 * أي تعديل هنا يجب أن يُطبَّق أيضاً على functions/src/lib/notifications.ts
 * والعكس، فالملفان يطبّقان نفس الخوارزمية في بيئتي تشغيل منفصلتين):
 *
 * 1) معرّف المستند = sha1(dedupeKey)، وليس معرّفاً عشوائياً — أي استدعاء
 *    متكرر لنفس dedupeKey (نقرة مزدوجة على زر، إعادة محاولة شبكية، طلب
 *    HTTP مكرر) يكتب بالضبط نفس معرّف المستند. معاملة Firestore تتحقق من
 *    عدم وجوده أولاً، فتكون النتيجة "مرة واحدة بالضبط" دائماً — بعكس
 *    `.add()` بالتصميم القديم الذي لم يكن يملك أي حماية من التكرار إطلاقاً.
 * 2) عدّاد notifUnreadCount يُزاد ذرّياً بنفس المعاملة التي تكتب الإشعار —
 *    مصدر الحقيقة الوحيد لعدد غير المقروء (بدل عدّ عناصر القائمة المحمَّلة
 *    بالعميل، التي كانت تُخطئ فور تجاوز حد الـlimit بالاستعلام).
 * 3) رسائل FCM "data-only" حصراً (بدون حقل notification أعلى المستوى) —
 *    شرط تقني إلزامي: أي حقل notification أعلى المستوى يجعل النظام نفسه
 *    (لا كودنا) يقرر عرض الإشعار عبر مسار عرض تلقائي غير موثوق، متجاوزاً
 *    service worker/onMessageReceived بالكامل على بعض الأجهزة/المتصفحات.
 * 4) فشل إرسال الـPush لا يُسقط كتابة السجل أبداً، والعكس: لا نرسل Push إن
 *    كان الإشعار مكرراً (created === false) — وإلا كان كل استدعاء متكرر
 *    (retry) يُنتج تنبيه Push مزعجاً لإشعار موجود أصلاً بقائمة المستخدم.
 */

const SITE_BASE_URL = (process.env.SITE_BASE_URL || "https://eleven-sd.com").replace(/\/$/, "");

const PERMANENT_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export type NotifyUserInput = {
  userId: string;
  /**
   * مفتاح فريد يصف الحدث نفسه (وليس معرّفاً عشوائياً لكل استدعاء) — يجب أن
   * يبقى نفس القيمة بالضبط إن أُعيد تنفيذ نفس الحدث منطقياً. مثال:
   * `welcome:${uid}` أو `promo:${campaignId}:${uid}`. إن تُرك فارغاً
   * (undefined) يُستخدم معرّف عشوائي — أي بلا أي حماية من التكرار، لذا يجب
   * تمريره صراحة لكل حدث له معنى قد يتكرر تنفيذه.
   */
  dedupeKey: string;
  title: string;
  body: string;
  type: NotificationType;
  actionRoute?: string;
  /** رابط صورة اختيارية (إشعارات العروض غالباً) — تُحفظ بالسجل وتُرسل ضمن
   * بيانات FCM لعرضها بـAndroid (BigPictureStyle) وService Worker بالويب. */
  imageUrl?: string;
  entityType?: "order" | "coupon" | null;
  entityId?: string | null;
};

function notificationIdFromDedupeKey(dedupeKey: string): string {
  return crypto.createHash("sha1").update(dedupeKey).digest("hex").slice(0, 32);
}

function resolveAbsoluteLink(actionRoute?: string): string {
  const path = actionRoute && actionRoute.startsWith("/") ? actionRoute : "/notifications";
  return `${SITE_BASE_URL}${path}`;
}

async function pruneDeadTokens(userId: string, tokens: string[], responses: admin.messaging.SendResponse[]) {
  const deadTokens: string[] = [];
  responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code && PERMANENT_TOKEN_ERROR_CODES.has(resp.error.code)) {
      deadTokens.push(tokens[idx]);
    }
    if (!resp.success) {
      console.error(`[Notifications] فشل تسليم التوكن #${idx}:`, resp.error?.message);
    }
  });
  if (deadTokens.length > 0) {
    await adminDb.collection("users").doc(userId).update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...deadTokens),
    });
  }
}

async function pushToDevices(
  userId: string,
  notificationId: string,
  title: string,
  body: string,
  type: NotificationType,
  actionRoute?: string,
  imageUrl?: string
) {
  const userSnap = await adminDb.collection("users").doc(userId).get();
  const tokens: string[] = userSnap.data()?.fcmTokens || [];
  if (tokens.length === 0) return;

  const message: admin.messaging.MulticastMessage = {
    // ⚠️ لا يوجد حقل "notification" هنا عمداً — راجع الشرح أعلى الملف.
    // ✅ إصلاح: أُزيل android.notification بالكامل (كان يحوي channelId/tag
    // فقط بلا عنوان أو نص). مجرد وجود هذا الحقل — حتى بلا عنوان/نص — يجعل
    // أندرويد يصنّف الرسالة "رسالة عرض" ويعرضها هو تلقائياً حين يكون التطبيق
    // بالخلفية أو مغلقاً، متجاوزاً onMessageReceived في
    // ElevenFirebaseMessagingService.kt تماماً؛ وبما أن الحقل فارغ من
    // عنوان/نص، يظهر إشعار بلا محتوى (بالضبط الأعراض المُبلَّغ عنها). الآن
    // الرسالة data-only حقيقية بلا أي استثناء، فيبقى onMessageReceived هو
    // المسؤول الوحيد عن العرض في كل الحالات (مقدمة/خلفية/تطبيق مغلق)، بنفس
    // العنوان والنص الصحيحين دائماً.
    data: { notificationId, title, body, type, actionRoute: actionRoute || "", imageUrl: imageUrl || "" },
    tokens,
    android: {
      priority: "high",
    },
    webpush: {
      headers: { Urgency: "high" },
      fcmOptions: { link: resolveAbsoluteLink(actionRoute) },
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    if (response.failureCount > 0) {
      await pruneDeadTokens(userId, tokens, response.responses);
    }
  } catch (error) {
    console.error("[Notifications] تعذّر إرسال الـPush:", error);
  }
}

/**
 * ينشئ سجل الإشعار بشكل idempotent (معرّف حتمي + معاملة تتحقق من الوجود
 * أولاً). لا تلمس notifUnreadCount هنا إطلاقاً — Cloud Function مستقلة
 * (functions/src/triggers/notificationCounterTrigger.ts) تلاحظ أي كتابة
 * على مسار users/{uid}/notifications بصرف النظر عن مصدرها (Firestore
 * trigger يعمل على مستوى المستند نفسه، لا يهمه أي عملية سيرفر كتبته) وتتكفّل
 * بتسوية العدّاد ذرّياً بنفسها. تُعيد created:false إن كان هذا الحدث بالذات
 * قد عُولج من قبل — بدون رمي خطأ، فالاستدعاء المتكرر لنفس dedupeKey يجب أن
 * يكون آمناً دوماً.
 */
export async function createNotificationRecord(
  input: Omit<NotifyUserInput, never>
): Promise<{ id: string; created: boolean }> {
  const id = notificationIdFromDedupeKey(input.dedupeKey);
  const notifRef = adminDb.collection("users").doc(input.userId).collection("notifications").doc(id);

  const created = await adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(notifRef);
    if (existing.exists) return false;
    tx.set(notifRef, {
      dedupeKey: input.dedupeKey,
      title: input.title,
      body: input.body,
      type: input.type,
      isRead: false,
      readAt: null,
      actionRoute: input.actionRoute ?? null,
      imageUrl: input.imageUrl ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdAt: admin.firestore.Timestamp.now(),
    });
    return true;
  });

  return { id, created };
}

/**
 * نقطة الدخول الوحيدة لإرسال إشعار "عام" (غير متعلق بطلب) لمستخدم: تكتب
 * السجل idempotent ثم ترسل push فقط إن كان الإشعار جديداً فعلاً.
 */
export async function notifyUser(input: NotifyUserInput): Promise<void> {
  if (!input.userId) {
    console.warn("[Notifications] notifyUser بدون userId — تم التجاهل");
    return;
  }
  if (!input.dedupeKey) {
    console.warn("[Notifications] notifyUser بدون dedupeKey — لا حماية من التكرار لهذا الاستدعاء");
  }

  let id: string;
  let created: boolean;
  try {
    const result = await createNotificationRecord(input);
    id = result.id;
    created = result.created;
  } catch (error) {
    console.error("[Notifications] تعذّرت كتابة سجل الإشعار:", error);
    return; // بدون id موثوق لا يمكن إرسال push مرتبط بنفس معرّف العرض بأمان
  }

  if (!created) return; // حدث مكرر عُولج من قبل — لا Push جديد.
  await pushToDevices(input.userId, id, input.title, input.body, input.type, input.actionRoute, input.imageUrl);
}
