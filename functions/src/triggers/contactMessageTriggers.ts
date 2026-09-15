import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { createAdminAlert } from "../lib/adminAlerts";
import { checkRateLimitFirestore } from "../lib/rateLimit";

/**
 * رسائل "تواصل معنا" — قبل هذا الملف لم يكن هناك أي trigger عليها إطلاقاً
 * (تُكتب مباشرة من عميل الأندرويد إلى contactMessages/{id}، راجع التعليق
 * أعلى admin-contact-router.ts)، فلم يكن هناك أي طريقة لتنبيه أحد بلحظة
 * وصولها — الأدمن يكتشفها فقط لو فتح صفحة "رسائل التواصل" بنفسه.
 *
 * ⚠️ قرار مبدئي يحتاج تأكيداً: الصلاحية المطلوبة هنا "contactMessages"
 * (نفس صلاحية صفحة الرسائل، اتساقاً مع نمط orders → orders). لو المقصود
 * فعلاً صلاحية "notifications" بدلاً منها، هذا السطر الوحيد المطلوب تغييره.
 *
 * ✅ إصلاح (مراجعة لاحقة): firestore.rules تسمح بالإنشاء حتى بدون تسجيل
 * دخول وبلا أي تحديد لمعدل الطلبات — أي سكربت يقدر يبعت آلاف المستندات
 * بالثانية طالما الحقول شكلها سليم (طول/نوع فقط). هذا الـtrigger هو نقطة
 * الدفاع العملية الوحيدة الممكنة هنا (القواعد لا تقدر تعمل rate limiting
 * حقيقي بلا هوية ثابتة للمرسل — لا يوجد Firebase Auth إطلاقاً للضيوف بهذا
 * التطبيق، وليس حتى تسجيل دخول مجهول/anonymous). يستخدم checkRateLimitFirestore
 * الموجود أصلاً (نفس أداة تحديد OTP) بمستويين:
 *   1) حد عام (كل الرسائل معاً) يحمي "جرس" اللوحة نفسه من الإغراق —
 *      هذا أهم من حماية المجموعة، لأن فيضان تنبيهات وهمية بلوحة أدمن
 *      واحدة أسوأ عملياً من امتلاء مجموعة Firestore.
 *   2) حد لكل مُرسِل (uid لو مسجّل دخول، وإلا الإيميل كأفضل تقريب متاح
 *      — قابل للتحايل من مهاجم يبدّل الإيميل، لكنه يوقف نفس السكربت
 *      الساذج المتكرر بنفس البيانات).
 * أي رسالة تتخطى الحدين تُحذف فوراً (بدل إبقائها/تنبيه أدمن بها) — القرار
 * أن نظافة المجموعة والجرس أهم من الاحتفاظ برسائل سبام. الحماية الجذرية
 * ضد الضيوف تحديداً تبقى تفعيل "Enforce" على Firebase App Check (مُجهَّز
 * فعلاً بالتطبيق عبر Play Integrity — راجع ElevenStoreApp.kt — لكنه بانتظار
 * خطوة التفعيل اليدوية بلوحة Firebase)، فهذا يرفض الطلب قبل وصوله لـFirestore
 * أصلاً بغض النظر عن هوية المُرسِل؛ ما هنا مجرد خط دفاع إضافي بعد الكتابة.
 */
const GLOBAL_MAX = 20; // بحد أقصى 20 رسالة جديدة كل 5 دقائق بكل المتجر مجتمعاً
const GLOBAL_WINDOW_MS = 5 * 60 * 1000;
const SENDER_MAX = 3; // بحد أقصى 3 رسائل كل 10 دقائق لنفس المُرسِل (uid أو إيميل)
const SENDER_WINDOW_MS = 10 * 60 * 1000;

export const onContactMessageCreated = onDocumentCreated(
  "contactMessages/{messageId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const messageId = event.params.messageId as string;

    const senderKey: string = data.userId || data.email || "unknown";

    const [globalOk, senderOk] = await Promise.all([
      checkRateLimitFirestore("contact_msg_global", GLOBAL_MAX, GLOBAL_WINDOW_MS),
      checkRateLimitFirestore(`contact_msg_sender:${senderKey}`, SENDER_MAX, SENDER_WINDOW_MS),
    ]);

    if (!globalOk || !senderOk) {
      console.warn(
        `[ContactMessages] تجاوز حد المعدل (global=${globalOk}, sender=${senderOk}) — حذف الرسالة ${messageId}`
      );
      await snap.ref.delete().catch((err) =>
        console.error("[ContactMessages] فشل حذف رسالة تجاوزت الحد:", err)
      );
      return;
    }

    const name: string = data.name || "زائر";
    const subjectOrPreview: string = data.subject || data.message || "";
    const preview = subjectOrPreview.length > 80
      ? `${subjectOrPreview.slice(0, 80)}…`
      : subjectOrPreview;

    await createAdminAlert({
      dedupeKey: `contact_message_created:${messageId}`,
      type: "contactMessage",
      requiredPermission: "contactMessages",
      title: "رسالة تواصل جديدة",
      body: preview ? `${name}: ${preview}` : `رسالة جديدة من ${name}`,
      actionRoute: "/contact-messages",
      entityType: "contactMessage",
      entityId: messageId,
    });
  }
);
