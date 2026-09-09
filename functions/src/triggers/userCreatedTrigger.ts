import * as functionsV1 from "firebase-functions/v1";
import { sendMail } from "../lib/mailer";
import { welcomeEmailTemplate } from "../lib/emailTemplates";

/**
 * ELEVEN STORE — رسالة ترحيب تلقائية عند إنشاء حساب جديد
 * ═══════════════════════════════════════════════════════════════════════
 * تعمل على أي حساب جديد بصرف النظر عن طريقة التسجيل (بريد/كلمة مرور أو
 * Google) لأنها auth trigger على مستوى Firebase Auth نفسه، لا على مسار
 * تسجيل محدَّد بكود العميل — بنفس فلسفة onUserDeleted (مصدر واحد للحقيقة
 * بدل تكرار الاستدعاء بكل شاشة تسجيل في كل منصة).
 * فشل الإرسال (تجاوز حصة Gmail اليومية مثلاً) لا يجب أن يظهر كخطأ غامض في
 * سجلات Cloud Functions بلا سياق، ولا يؤثر بأي شكل على نجاح إنشاء الحساب
 * نفسه (الذي تم فعلياً قبل استدعاء هذا الـtrigger أصلاً).
 */
export const onUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  if (!user.email) return;
  try {
    const { subject, html } = welcomeEmailTemplate(user.displayName || "");
    await sendMail({ to: user.email, subject, html });
  } catch (err) {
    console.error(`[onUserCreated] فشل إرسال رسالة الترحيب لـ ${user.uid}:`, err);
  }
});
