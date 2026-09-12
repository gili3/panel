/**
 * ELEVEN STORE — قوالب البريد الإلكتروني الموحّدة
 * ═══════════════════════════════════════════════════════════════════════
 * كل رسائل المتجر (ترحيب، تأكيد حساب، استعادة كلمة مرور، رمز حذف الحساب،
 * تأكيد الحذف) تمر عبر renderEmailLayout() نفسها — تصميم واحد (رأس بلون
 * العلامة، محتوى RTL بالعربية، زر إجراء واحد واضح، تذييل موحّد) بدل كل
 * رسالة بتنسيقها الخاص. أي رابط إجراء (تأكيد/استعادة) يظهر كزر، مع نسخة
 * نصية للرابط تحته فقط كخيار احتياطي إن فشل الزر بعميل بريد قديم.
 */

// لون العلامة نفسه المستخدم في تطبيق الأندرويد والموقع (Ink/Primary)
const BRAND_COLOR = "#0F172A";
// ✅ إصلاح: أُزيل رابط eleven-sd.com نهائياً من كل الرسائل (زر الترحيب +
// تذييل كل رسالة). كان يفتح لوحة التحكم الداخلية بدل واجهة متجر — أي عميل
// بيفتح أي إيميل من المتجر (حتى رسالة استعادة كلمة المرور) كان ممكن يوصل
// لصفحة الأدمن بالغلط. الموقع (SITE_BASE_URL) لسه مستخدم في مكانه الصحيح
// بملف authEmails.ts فقط (continue URL بروابط Firebase Auth الفعلية).

interface EmailLayoutOptions {
  title: string;
  /** فقرات المحتوى، HTML جاهز وآمن (بدون أي مُدخل خام من المستخدم) */
  bodyHtml: string;
  buttonText?: string;
  buttonUrl?: string;
  footerNote?: string;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const { title, bodyHtml, buttonText, buttonUrl, footerNote } = opts;

  const buttonBlock =
    buttonText && buttonUrl
      ? `
    <tr>
      <td align="center" style="padding: 28px 0 8px 0;">
        <a href="${buttonUrl}" target="_blank"
           style="background-color:${BRAND_COLOR}; color:#ffffff; text-decoration:none;
                  padding:14px 42px; border-radius:8px; font-size:16px; font-weight:600;
                  display:inline-block; font-family:Tahoma, Arial, sans-serif;">
          ${buttonText}
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 4px 24px 4px 24px;">
        <p style="font-size:12px; color:#94a3b8; font-family:Tahoma, Arial, sans-serif; margin:0; word-break:break-all; line-height:1.6;">
          إذا لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br/>
          <a href="${buttonUrl}" style="color:#64748b;">${buttonUrl}</a>
        </p>
      </td>
    </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family: Tahoma, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px; background-color:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e2e8f0;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background-color:${BRAND_COLOR}; padding:26px 24px; text-align:center;">
              <span style="color:#ffffff; font-size:22px; font-weight:700; letter-spacing:0.5px; font-family:Tahoma, Arial, sans-serif;">Eleven Store</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 28px 8px 28px; text-align:right;">
              <h1 style="font-size:20px; color:#0f172a; margin:0 0 16px 0; font-family:Tahoma, Arial, sans-serif;">${title}</h1>
              <div style="font-size:15px; color:#334155; line-height:1.9; font-family:Tahoma, Arial, sans-serif;">${bodyHtml}</div>
            </td>
          </tr>
          ${buttonBlock}
          <tr>
            <td style="padding: 24px 28px 28px 28px; text-align:center; border-top:1px solid #f1f5f9;">
              ${footerNote ? `<p style="font-size:12px;color:#94a3b8;margin:16px 0 0 0; font-family:Tahoma, Arial, sans-serif;">${footerNote}</p>` : ""}
              <p style="font-size:12px;color:#cbd5e1;margin:8px 0 0 0; font-family:Tahoma, Arial, sans-serif;">
                © ${new Date().getFullYear()} Eleven Store
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

interface EmailContent {
  subject: string;
  html: string;
}

export function welcomeEmailTemplate(name: string): EmailContent {
  const greeting = name.trim() ? `أهلاً ${name} 👋` : "أهلاً بك 👋";
  return {
    subject: "أهلاً بك في Eleven Store 🎉",
    html: renderEmailLayout({
      title: greeting,
      bodyHtml:
        "<p>يسعدنا انضمامك إلى Eleven Store. حسابك جاهز الآن، ويمكنك تصفّح المنتجات والطلب مباشرة من التطبيق.</p>" +
        "<p>إذا احتجت أي مساعدة في أي وقت، فريقنا جاهز دائماً لخدمتك.</p>",
      // ✅ لا يوجد زر رابط هنا عمداً — راجع ملاحظة SITE_BASE_URL بأعلى الملف.
    }),
  };
}

export function verifyEmailOtpTemplate(otp: string, name?: string): EmailContent {
  const greeting = name?.trim() ? `أهلاً ${name.trim()} 👋` : "أهلاً بك 👋";
  return {
    subject: "أهلاً بك في Eleven Store — رمز تأكيد البريد 🎉",
    html: renderEmailLayout({
      title: greeting,
      bodyHtml:
        "<p>يسعدنا انضمامك إلى Eleven Store. استخدم الرمز التالي داخل التطبيق لتأكيد بريدك الإلكتروني.</p>" +
        `<p style="text-align:center; font-size:32px; font-weight:700; letter-spacing:10px; color:#0f172a; margin:24px 0;">${otp}</p>` +
        "<p>إذا لم تُنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.</p>",
      footerNote: "الرمز صالح لمدة 10 دقائق فقط.",
    }),
  };
}

export function resetPasswordOtpTemplate(otp: string): EmailContent {
  return {
    subject: "رمز إعادة تعيين كلمة المرور — Eleven Store",
    html: renderEmailLayout({
      title: "إعادة تعيين كلمة المرور",
      bodyHtml:
        "<p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك. استخدم الرمز التالي داخل التطبيق لمتابعة الإجراء.</p>" +
        `<p style="text-align:center; font-size:32px; font-weight:700; letter-spacing:10px; color:#0f172a; margin:24px 0;">${otp}</p>` +
        "<p>إذا لم تطلب ذلك، تجاهل هذه الرسالة ولن يتغيّر شيء في حسابك.</p>",
      footerNote: "الرمز صالح لمدة 10 دقائق فقط.",
    }),
  };
}

export function deletionOtpTemplate(otp: string): EmailContent {
  return {
    subject: "رمز تأكيد حذف الحساب — Eleven Store",
    html: renderEmailLayout({
      title: "تأكيد حذف الحساب",
      bodyHtml:
        "<p>استخدم الرمز التالي داخل التطبيق لتأكيد حذف حسابك نهائياً. هذا الإجراء لا يمكن التراجع عنه بعد تأكيده.</p>" +
        `<p style="text-align:center; font-size:32px; font-weight:700; letter-spacing:10px; color:#0f172a; margin:24px 0;">${otp}</p>` +
        "<p>إذا لم تطلب حذف حسابك، تجاهل هذه الرسالة فوراً ولا تشارك هذا الرمز مع أي أحد.</p>",
      footerNote: "الرمز صالح لمدة 10 دقائق فقط.",
    }),
  };
}

export function passwordChangedTemplate(): EmailContent {
  return {
    subject: "تم تغيير كلمة المرور — Eleven Store",
    html: renderEmailLayout({
      title: "تم تغيير كلمة المرور بنجاح",
      bodyHtml:
        "<p>نؤكّد أنه تم تغيير كلمة مرور حسابك بنجاح للتو.</p>" +
        "<p>إذا لم تكن أنت من قام بهذا التغيير، تواصل معنا فوراً عبر بريد الدعم لتأمين حسابك.</p>",
    }),
  };
}

export function accountDeletedTemplate(): EmailContent {
  return {
    subject: "تم حذف حسابك — Eleven Store",
    html: renderEmailLayout({
      title: "تم حذف حسابك بنجاح",
      bodyHtml:
        "<p>نؤكّد أنه تم حذف حسابك وكل بياناتك الشخصية المرتبطة به (السلة، المفضلة، العناوين، الإشعارات) بنجاح ونهائياً من Eleven Store.</p>" +
        "<p>إذا لم تكن أنت من طلب هذا الإجراء، تواصل معنا فوراً عبر بريد الدعم.</p>",
    }),
  };
}
