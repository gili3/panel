import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";

/**
 * ELEVEN STORE — تسوية عدّاد "غير المقروء" (v2)
 * ═══════════════════════════════════════════════════════════════════════
 * القرار المعماري: نقطة واحدة فقط في كامل النظام تُعدّل
 * users/{uid}.notifUnreadCount — هذا الـtrigger، ولا مكان آخر إطلاقاً.
 * أي كتابة على أي مستند users/{uid}/notifications/{id} (إنشاء/تعديل/حذف)
 * تُشغِّله تلقائياً، بصرف النظر عن مصدر تلك الكتابة: Cloud Function أخرى
 * (onOrderCreated بـAdmin SDK)، mutation بسيرفر الموقع (tRPC بـAdmin SDK)،
 * أو كتابة مباشرة من تطبيق الأندرويد (Client SDK لتعليم "مقروء" أو حذف).
 *
 * لماذا هذا التوحيد أفضل من حساب العدّاد يدوياً بكل دالة كتابة على حدة
 * (كما كانت تفعل نسخة v2 الأولى من هذا الملف عبر Cloud Functions Callable
 * مخصَّصة لكل إجراء)؟
 *   - يسمح لتطبيق الأندرويد بالعودة لكتابة Firestore مباشرة (Client SDK)
 *     لتعليم "مقروء"/الحذف، وهي كتابة تُصان تلقائياً بطابور offline من
 *     Firestore SDK نفسه عند انقطاع الاتصال وتُزامَن عند عودته — بعكس
 *     استدعاء Callable Function الذي يفشل فوراً بلا اتصال إطلاقاً بلا طابور.
 *   - يزيل تكرار منطق "زيادة/إنقاص العدّاد" عبر عدة ملفات (tRPC، Callable،
 *     Cloud Functions triggers) إلى نسخة واحدة فقط يجب صيانتها.
 *   - أي مسار إنشاء جديد يُضاف مستقبلاً (مثال: ميزة بث إشعار جماعي) يحصل
 *     تلقائياً على عدّاد صحيح دون أي كود إضافي، فقط بكتابة مستند الإشعار.
 *
 * ملاحظة موثوقية: Cloud Functions تضمن "على الأقل مرة" — من الناحية
 * النظرية قد يُعاد تنفيذ نفس الحدث (نفس before/after) مرتين نادراً جداً،
 * فيُزاد/يُنقص العدّاد مرتين لحدث واحد. هذا احتمال ضئيل جداً عملياً (خلاف
 * إنشاء الإشعار نفسه الذي يملك حماية صارمة عبر معرّف حتمي + معاملة، لأن
 * إنشاء مكرراً يعني رسالة Push مزعجة مكررة فعلياً وليس مجرد رقم عدّاد قد
 * ينحرف بمقدار 1 نادراً). قابل للتحسين لاحقاً بإضافة معرّف "آخر إصدار
 * احتُسب" على كل مستند إشعار إن استدعت الحاجة دقة مطلقة 100%.
 */
export const onNotificationWrite = onDocumentWritten(
  "users/{userId}/notifications/{notifId}",
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const userRef = db.collection("users").doc(event.params.userId as string);

    let delta = 0;
    if (!before && after) {
      // إنشاء جديد
      if (after.isRead === false) delta = 1;
    } else if (before && !after) {
      // حذف
      if (before.isRead === false) delta = -1;
    } else if (before && after) {
      // تعديل — فقط انتقال حالة isRead الفعلي يُغيّر العدّاد
      if (before.isRead === false && after.isRead === true) delta = -1;
      else if (before.isRead === true && after.isRead === false) delta = 1; // احترازي، لا مسار حالي يعيد التعليم "غير مقروء"
    }

    if (delta === 0) return;
    await userRef.set({ notifUnreadCount: FieldValue.increment(delta) }, { merge: true });
  }
);
