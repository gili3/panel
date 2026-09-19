import * as functionsV1 from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { db } from "../lib/admin";
import { sendMail } from "../lib/mailer";
import { generateOtp, hashOtp } from "../lib/otp";
import { deletionOtpTemplate, newSignInTemplate } from "../lib/emailTemplates";

/**
 * ELEVEN STORE — حذف الحساب برمز تأكيد (OTP)
 * ═══════════════════════════════════════════════════════════════════════
 * تأكيد البريد واستعادة كلمة المرور صارا بالكامل عبر رمز OTP (راجع
 * otpAuth.ts) — لا يوجد أي مسار روابط متبقٍّ بالمشروع بعد حذف
 * sendVerificationEmail و sendPasswordResetEmailCustom.
 */

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

// ─── تنبيه تسجيل دخول جديد ───────────────────────────────────────────────
/**
 * يُستدعى من العميل (Login.tsx) فور نجاح تسجيل الدخول (بريد/كلمة مرور أو
 * Google) — بلا انتظار (fire-and-forget) حتى لا يؤخّر توجيه المستخدم.
 * uid يُشتق من جلسة المصادقة context.auth.uid فقط (لا يمكن لأي عميل طلب
 * إرسال هذا التنبيه لبريد مستخدم آخر). "method" نص وصفي فقط لعرضه بالرسالة
 * (Google / البريد الإلكتروني)، لا قيمة أمنية له، فلا حاجة للتحقق الصارم منه.
 * فشل الإرسال هنا لا يجب أن يُفشل تسجيل الدخول نفسه — لذا هذه الدالة لا
 * ترمي خطأ للعميل عند فشل sendMail، فقط تسجّله وتُعيد sent:false.
 */
export const notifyNewSignIn = functionsV1.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functionsV1.https.HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
  }
  const uid = context.auth.uid;
  const method = typeof data?.method === "string" && data.method.trim() ? data.method.trim() : "غير معروف";

  try {
    const user = await admin.auth().getUser(uid);
    if (!user.email) return { sent: false };

    const dateTime = new Intl.DateTimeFormat("ar-SA", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Asia/Riyadh",
    }).format(new Date());

    const { subject, html } = newSignInTemplate({ method, dateTime });
    await sendMail({ to: user.email, subject, html });
    return { sent: true };
  } catch (error) {
    console.error("[notifyNewSignIn] فشل إرسال تنبيه تسجيل الدخول:", error);
    return { sent: false };
  }
});
