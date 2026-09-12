import { Resend } from "resend";

/**
 * ELEVEN STORE — إرسال البريد الإلكتروني عبر Resend
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ إصلاح جذري (كان يُرسَل عبر Gmail SMTP): تشخيص فعلي أثبت وصول رسائل
 * Gmail لصندوق Spam/Promotions عند بعض المستقبلين — سلوك متوقع لإرسال آلي
 * من حساب Gmail شخصي بدون SPF/DKIM محاذاة كخدمة بريد معاملات مخصّصة.
 * Resend مصمم تحديداً لهذا النوع من الرسائل (تأكيد بريد، استعادة كلمة
 * مرور، حذف حساب...)، وباقته المجانية (3000 رسالة/شهر) تغطي حجم المتجر
 * الحالي بمسافة كبيرة. باقي الكود (القوالب، الـtriggers) ما يتغيّر إطلاقاً
 * — الكل يتعامل فقط مع sendMail() ولا يعرف شيئاً عن المزوّد المستخدم.
 *
 * ملاحظة دومين: بدون دومين موثَّق بـResend (Domains → Add Domain)، يجب
 * إبقاء MAIL_FROM_ADDRESS على القيمة الافتراضية "onboarding@resend.dev" —
 * أي عنوان آخر غير موثَّق سيُرفَض الإرسال منه. بعد توثيق دومين خاص، حدّث
 * MAIL_FROM_ADDRESS بـ.env فقط، بدون أي تعديل كود.
 */

let cachedClient: Resend | null = null;

function getClient(): Resend {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // ✅ فشل فوري وواضح بدل محاولة إرسال تفشل بخطأ غامض من Resend لاحقاً —
    // نفس فلسفة fail-fast المستخدمة بـclient/src/lib/firebase.ts.
    throw new Error(
      "[mailer] RESEND_API_KEY غير مضبوط في functions/.env — " +
        "أنشئ مفتاحاً من resend.com/api-keys."
    );
  }

  cachedClient = new Resend(apiKey);
  return cachedClient;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const client = getClient();
  const fromName = process.env.MAIL_FROM_NAME || "Eleven Store";
  const fromAddress = process.env.MAIL_FROM_ADDRESS || "onboarding@resend.dev";

  const { error } = await client.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });

  if (error) {
    // ✅ Resend يرجّع خطأ كحقل بالرد بدل رمي استثناء تلقائياً في كل الحالات
    // — نرميه صراحة هنا عشان الكود المستدعي (authEmails.ts) يتعامل معه
    // بنفس منطق try/catch الموجود أصلاً، بدون تغيير أي شيء هناك.
    throw new Error(`[mailer] فشل الإرسال عبر Resend: ${error.name} — ${error.message}`);
  }
}
