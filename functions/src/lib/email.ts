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
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) return trimmed;

  const local = trimmed.substring(0, atIndex);
  const domain = trimmed.substring(atIndex + 1).toLowerCase();

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return `${local}@${domain}`;
}
