/**
 * ELEVEN STORE — توحيد صيغة البريد الإلكتروني (Gmail)
 * ═══════════════════════════════════════════════════════════════════════
 * جيميل يتجاهل النقاط داخل الجزء المحلي من العنوان فعلياً على مستوى
 * التسليم (yxr.249@gmail.com و yxr249@gmail.com يصلان لنفس صندوق البريد)،
 * لكن Firebase Auth يتعامل معهما كحسابين مختلفين تماماً بصرف النظر عن ذلك.
 * normalizeEmail() تُستخدم في كل نقطة نبحث فيها عن مستخدم ببريده (طلب
 * رمز استعادة كلمة المرور هنا)، لتطابق نفس الصيغة التي يُخزَّن بها البريد
 * فعلياً بـFirebase Auth (العميل يطبّق نفس التطبيع قبل التسجيل/الدخول —
 * راجع normalizeEmailForAuth في FirestoreRepository.kt بتطبيق أندرويد).
 * لا نلمس أي نطاق غير Gmail/Googlemail، ولا نتعامل مع علامة "+" (لم تُطلب).
 *
 * ✅ إصلاح: الحروف الصغيرة تُطبَّق على العنوان كاملاً (وليس النطاق فقط). Firebase
 * Auth يعامل البريد بلا حساسية لحالة الأحرف، لكن مفاتيح الـOTP وتحديد المعدّل
 * هنا تُشتق من النص المطبَّع — فبدون هذا كان "User@x.com" و"user@x.com" يعطيان
 * مستندَي OTP ومفتاحَي تحديد معدّل مختلفين لنفس الحساب: (1) طلب الرمز بصيغة
 * والتأكيد بأخرى يفشل بـ"لم يتم طلب رمز"، و(2) يمكن تجاوز حد الإرسال/المحاولات
 * بتبديل حالة الأحرف فقط.
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) return trimmed;

  const local = trimmed.substring(0, atIndex);
  const domain = trimmed.substring(atIndex + 1).toLowerCase();

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return `${local}@${domain}`;
}
