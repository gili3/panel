import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { notify } from "../lib/notifications";

/**
 * ELEVEN STORE — إشعارات الطلبات v2 (Cloud Functions Firestore Triggers)
 * ═══════════════════════════════════════════════════════════════════════
 * لماذا هنا وليس في السيرفر (tRPC) أو في تطبيق الأندرويد مباشرة؟
 * ───────────────────────────────────────────────────────────────────────
 * في النظام القديم كان هناك مساران منفصلان تماماً لإنشاء نفس نوع الإشعار:
 *   1) الموقع يطلب عبر السيرفر (tRPC) → السيرفر يكتب الطلب بـAdmin SDK
 *      ثم يستدعي notifyUser يدوياً بنفس الاستدعاء.
 *   2) تطبيق الأندرويد يكتب الطلب مباشرة على Firestore من العميل (placeOrder
 *      بدون سيرفر وسيط لأسباب دعم العمل بدون اتصال)، ثم يكتب هو نفسه سجل
 *      الإشعار مباشرة على Firestore (FirestoreRepository.writeNotificationDoc).
 * المشكلة: المسار الثاني كتابة Firestore من العميل مباشرة، أي لا يستطيع
 * إرسال Push فعلياً (يتطلب Admin SDK) — نتيجة ذلك: صاحب المتجر لم يكن
 * يصله أي تنبيه Push إطلاقاً عن طلبات وصلت من تطبيق الأندرويد، فقط سجل
 * صامت بقائمة الإشعارات إن فتحها بنفسه. كما أن نص الإشعار وقواعد بنائه
 * كانا مكرَّرين بلغتين مختلفتين (TypeScript + Kotlin) عرضة للتباعد بأي تعديل.
 *
 * الحل: أي طلب — من الموقع عبر السيرفر أو من التطبيق مباشرة على Firestore —
 * ينتهي بكتابة مستند واحد في orders/{orderId}. هذا الـtrigger يلاحظ تلك
 * الكتابة نفسها بصرف النظر عن مصدرها، فيصبح مساراً واحداً وحيداً لإشعارات
 * الطلبات على الإطلاق. تطبيق الأندرويد لم يعد يكتب أي إشعار بنفسه إطلاقاً
 * (أُزيل writeNotificationDoc بالكامل من FirestoreRepository.kt).
 *
 * الموثوقية: Cloud Functions تضمن "على الأقل مرة" (at-least-once) — أي قد
 * يُنفَّذ نفس الـtrigger أكثر من مرة لنفس الحدث في حالات نادرة (إعادة
 * محاولة داخلية من المنصة). notify() في lib/notifications.ts محصَّنة ضد
 * هذا تماماً عبر معرّف حتمي (sha1 لمفتاح الحدث) + معاملة تتحقق من عدم
 * الوجود قبل الكتابة، فتُصبح النتيجة الفعلية "مرة واحدة بالضبط" مهما تكرر
 * تنفيذ الدالة نفسها.
 */

const ORDER_STATUS_LABELS_AR: Record<string, string> = {
  paid: "تم تأكيد الدفع",
  shipped: "تم شحن طلبك",
  delivered: "تم توصيل الطلب",
  cancelled: "تم إلغاء الطلب",
};

const ORDER_STATUS_NOTIF_TYPE: Record<string, "shipping" | "order" | "general"> = {
  shipped: "shipping",
  delivered: "order",
  paid: "order",
  cancelled: "general",
};

/** طلب جديد: إشعار للعميل بالاستلام + إشعار لصاحب المتجر بطلب جديد. */
export const onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data();
  const orderId = event.params.orderId as string;
  const customerId: string | undefined = order.userId;
  const orderNumber: string = order.orderNumber ? String(order.orderNumber) : orderId.slice(0, 8);
  const actionRoute = `/order/${orderId}`;
  const ownerUid = process.env.OWNER_OPEN_ID || "";

  const tasks: Promise<unknown>[] = [];

  if (customerId) {
    tasks.push(
      notify({
        userId: customerId,
        dedupeKey: `order_created:customer:${orderId}`,
        type: "order",
        title: "تم استلام طلبك ✓",
        body: `طلبك رقم #${orderNumber} تم استلامه بنجاح وسيتم مراجعته قريباً.`,
        actionRoute,
        entityType: "order",
        entityId: orderId,
      })
    );
  } else {
    console.warn(`[onOrderCreated] الطلب ${orderId} بلا userId — تم تجاهل إشعار العميل`);
  }

  if (ownerUid && ownerUid !== customerId) {
    tasks.push(
      notify({
        userId: ownerUid,
        dedupeKey: `order_created:admin:${orderId}`,
        type: "order",
        title: "طلب جديد",
        body: `تم استلام طلب جديد رقم #${orderNumber}`,
        actionRoute,
        entityType: "order",
        entityId: orderId,
      })
    );
  } else if (!ownerUid) {
    console.warn("[onOrderCreated] OWNER_OPEN_ID غير مُهيّأ بإعدادات Cloud Functions — لن يصل إشعار الطلب الجديد للأدمن");
  }

  await Promise.all(tasks);
});

/** تغيّر حالة الطلب فقط — أي حقل آخر يتغيّر بالمستند لا يُنتج أي إشعار. */
export const onOrderStatusChanged = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const prevStatus: string | undefined = before.status;
  const newStatus: string | undefined = after.status;
  if (!newStatus || prevStatus === newStatus) return; // لا تغيّر فعلي بالحالة — لا شيء نفعله.

  const label = ORDER_STATUS_LABELS_AR[newStatus];
  if (!label) return; // حالة غير معروفة (لا نص إشعار مخصَّص لها) — تُتجاهل بأمان.

  const customerId: string | undefined = after.userId;
  if (!customerId) return;

  const orderId = event.params.orderId as string;
  const orderNumber: string = after.orderNumber ? String(after.orderNumber) : orderId.slice(0, 8);

  await notify({
    userId: customerId,
    // مفتاح التفرّد مرتبط بالحالة نفسها لا بمجرد "تحديث حدث" — لو انتقل
    // الطلب لاحقاً لنفس الحالة مرة أخرى (تصحيح يدوي من الأدمن مثلاً) لن
    // يُعاد نفس الإشعار تحديداً مرتين، بينما أي حالة *جديدة* مختلفة تُنتج
    // إشعاراً جديداً طبيعياً.
    dedupeKey: `order_status:${orderId}:${newStatus}`,
    type: ORDER_STATUS_NOTIF_TYPE[newStatus] || "general",
    title: "تحديث حالة الطلب",
    body: `حالة طلبك #${orderNumber}: ${label}`,
    actionRoute: `/order/${orderId}`,
    entityType: "order",
    entityId: orderId,
  });
});
