import * as functionsV1 from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { db } from "../lib/admin";
import { sendMail } from "../lib/mailer";
import { generateOtp, hashOtp } from "../lib/otp";
import {
  verifyEmailTemplate,
  resetPasswordTemplate,
  deletionOtpTemplate,
} from "../lib/emailTemplates";

/**
 * ELEVEN STORE — دوال البريد المخصّصة (Callable Functions)
 * ═══════════════════════════════════════════════════════════════════════
 * لماذا نولّد روابط تأكيد الحساب/استعادة كلمة المرور يدوياً بدل الاعتماد
 * على إرسال Firebase Auth التلقائي؟
 * ───────────────────────────────────────────────────────────────────────
 * قوالب Firebase الافتراضية تُظهر الرابط الخام مباشرة بلا أي تصميم موحّد
 * مع بقية رسائل المتجر. admin.auth().generateEmailVerificationLink() /
 * generatePasswordResetLink() تُنشئ نفس الرابط الفعلي (نفس آلية Firebase
 * الأمنية تماماً — صلاحية محدودة، رمز لمرة واحدة) لكن دون إرسال Firebase
 * التلقائي له؛ نرسله نحن عبر sendMail() بقالبنا الموحّد (زر واضح + تصميم
 * العلامة). العميل (تطبيق/موقع) يستدعي هاتين الدالتين بدل
 * user.sendEmailVerification() / sendPasswordResetEmail() المباشرتين.
 */

const CONTINUE_URL = (process.env.SITE_BASE_URL || "https://eleven-sd.com").replace(/\/$/, "");

// ─── تأكيد البريد الإلكتروني ────────────────────────────────────────────
export const sendVerificationEmail = functionsV1.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functionsV1.https.HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
  }
  const user = await admin.auth().getUser(context.auth.uid);
  if (!user.email) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "لا يوجد بريد إلكتروني مرتبط بهذا الحساب"
    );
  }
  if (user.emailVerified) {
    return { alreadyVerified: true };
  }

  const link = await admin.auth().generateEmailVerificationLink(user.email, {
    url: CONTINUE_URL,
  });
  const { subject, html } = verifyEmailTemplate(link);
  await sendMail({ to: user.email, subject, html });
  return { sent: true };
});

// ─── استعادة كلمة المرور ────────────────────────────────────────────────
export const sendPasswordResetEmailCustom = functionsV1.https.onCall(async (data) => {
  const email = typeof data?.email === "string" ? data.email.trim() : "";
  if (!email) {
    throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني مطلوب");
  }

  try {
    const link = await admin.auth().generatePasswordResetLink(email, { url: CONTINUE_URL });
    const { subject, html } = resetPasswordTemplate(link);
    await sendMail({ to: email, subject, html });
  } catch (err: unknown) {
    // ✅ لا نكشف للمستخدم إن كان البريد مسجَّلاً بحساب من عدمه (منع
    // user enumeration) — الاستجابة نفسها دائماً بصرف النظر عن النتيجة
    // الفعلية. نسجّل فقط الأخطاء غير المتوقعة (ليس "بريد غير موجود").
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[sendPasswordResetEmailCustom] فشل غير متوقع:", err);
    }
  }
  return { sent: true };
});

// ─── حذف الحساب برمز تأكيد (OTP) ────────────────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000; // 10 دقائق
const MAX_OTP_ATTEMPTS = 5;

function deletionOtpRef(uid: string) {
  return db.collection("users").doc(uid).collection("security").doc("deletionOtp");
}

/**
 * الخطوة 1: يُستدعى بعد إعادة مصادقة ناجحة بكلمة المرور/Google على العميل.
 * يولّد رمزاً من 6 أرقام، يخزّن بصمته فقط (لا الرمز نفسه) مع وقت انتهاء
 * صلاحية، ويرسله للبريد المسجَّل بالحساب (وليس أي بريد يرسله العميل —
 * uid يُشتق من جلسة المصادقة context.auth.uid فقط).
 */
export const requestAccountDeletionOtp = functionsV1.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functionsV1.https.HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
  }
  const uid = context.auth.uid;
  const user = await admin.auth().getUser(uid);
  if (!user.email) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "لا يوجد بريد إلكتروني مرتبط بهذا الحساب"
    );
  }

  const otp = generateOtp();
  await deletionOtpRef(uid).set({
    hash: hashOtp(otp),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
    attempts: 0,
  });

  const { subject, html } = deletionOtpTemplate(otp);
  await sendMail({ to: user.email, subject, html });
  return { sent: true };
});

/**
 * الخطوة 2 (الأخيرة): تتحقق من الرمز، وعند صحته تحذف الحساب فعلياً هنا —
 * من السيرفر عبر admin.auth().deleteUser(uid)، وليس عبر user.delete()
 * على العميل. هذا يضمن أن الحذف الفعلي لا يمكن أن يحدث إلا بعد إثبات
 * امتلاك الوصول الفعلي لبريد الحساب (وليس فقط كلمة المرور)، ويبقى
 * onUserDeleted (auth trigger) هو من يتكفّل بتنظيف بيانات Firestore
 * وإرسال رسالة تأكيد الحذف — مصدر واحد للحقيقة، بصرف النظر عن أي منصة
 * (موقع أو أندرويد) بدأت عملية الحذف.
 */
export const confirmAccountDeletion = functionsV1.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functionsV1.https.HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
  }
  const uid = context.auth.uid;
  const otp = typeof data?.otp === "string" ? data.otp.trim() : "";
  if (!otp) {
    throw new functionsV1.https.HttpsError("invalid-argument", "رمز التأكيد مطلوب");
  }

  const ref = deletionOtpRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "لم يتم طلب رمز تأكيد بعد، يرجى المحاولة من البداية"
    );
  }

  const record = snap.data() as { hash: string; expiresAt: admin.firestore.Timestamp; attempts: number };

  if (record.expiresAt.toMillis() < Date.now()) {
    await ref.delete();
    throw new functionsV1.https.HttpsError("deadline-exceeded", "انتهت صلاحية الرمز، يرجى طلب رمز جديد");
  }
  if ((record.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    await ref.delete();
    throw new functionsV1.https.HttpsError(
      "resource-exhausted",
      "عدد محاولات كبير جداً، يرجى طلب رمز جديد"
    );
  }
  if (hashOtp(otp) !== record.hash) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
    throw new functionsV1.https.HttpsError("invalid-argument", "رمز التأكيد غير صحيح");
  }

  await ref.delete();
  await admin.auth().deleteUser(uid);
  return { deleted: true };
});
