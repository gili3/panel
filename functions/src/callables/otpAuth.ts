import * as crypto from "crypto";
import * as functionsV1 from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { db } from "../lib/admin";
import { sendMail } from "../lib/mailer";
import { generateOtp, hashOtp } from "../lib/otp";
import { normalizeEmail } from "../lib/email";
import { verifyEmailOtpTemplate, resetPasswordOtpTemplate } from "../lib/emailTemplates";

/**
 * ELEVEN STORE — تأكيد البريد واستعادة كلمة المرور عبر رمز (OTP)
 * ═══════════════════════════════════════════════════════════════════════
 * استبدال لمسار الروابط في authEmails.ts (sendVerificationEmail /
 * sendPasswordResetEmailCustom) بناءً على طلب مباشر: رمز من 6 أرقام يُدخَل
 * داخل التطبيق نفسه بدل فتح رابط خارجي (فايربيز نفسه، أو تطبيق البريد،
 * قد يفتحان متصفحاً منفصلاً عن التطبيق — تجربة أسوأ على الموبايل تحديداً).
 * نفس فلسفة وبنية requestAccountDeletionOtp/confirmAccountDeletion
 * بالضبط (بصمة SHA-256 فقط تُخزَّن، لا الرمز نفسه؛ صلاحية 10 دقائق؛ حد
 * أقصى للمحاولات). دوال authEmails.ts القديمة تبقى بالملف الآخر دون حذف
 * لتفادي كسر أي استدعاء قديم لم يُحدَّث بعد على منصة أخرى، لكن العميل
 * (أندرويد) يستدعي هذه الدوال الجديدة حصراً من الآن.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 دقائق
const MAX_OTP_ATTEMPTS = 5;

function emailKey(normalizedEmail: string): string {
  // ✅ البريد قد يحتوي أحرفاً غير صالحة كمعرّف مستند Firestore (كـ"/")،
  // ونتجنب أيضاً تخزين البريد الخام كمعرّف مستند قابل للتخمين مباشرة.
  return crypto.createHash("sha256").update(normalizedEmail).digest("hex");
}

interface OtpRecord {
  hash: string;
  expiresAt: admin.firestore.Timestamp;
  attempts: number;
}

async function verifyAndConsumeOtp(
  ref: admin.firestore.DocumentReference,
  otp: string
): Promise<void> {
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "لم يتم طلب رمز تأكيد بعد، يرجى المحاولة من البداية"
    );
  }
  const record = snap.data() as OtpRecord;

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
}

// ─── تأكيد البريد الإلكتروني برمز ────────────────────────────────────────

function verifyEmailOtpRef(uid: string) {
  return db.collection("users").doc(uid).collection("security").doc("verifyEmailOtp");
}

/**
 * ✅ context.auth اختياري: تُستدعى وهي مسجَّلة الدخول فوراً بعد التسجيل
 * (قبل auth.signOut() بأندرويد) ومن شاشة الإعدادات، لكن أيضاً بلا جلسة
 * إطلاقاً من زر "إعادة الإرسال" بشاشة إدخال الرمز نفسها (بعد أن تكون
 * registerWithEmail سجّلت الخروج بالفعل) — عندها نستقبل email بالبيانات
 * ونبحث بنفس منطق حماية enumeration المستخدم بـsendPasswordResetOtp (رد
 * نجاح ثابت بصرف النظر عن وجود الحساب فعلياً).
 */
export const sendEmailVerificationOtp = functionsV1.https.onCall(async (data, context) => {
  let uid: string;
  let email: string;
  let name: string | undefined;

  if (context.auth) {
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
    uid = user.uid;
    email = user.email;
    name = user.displayName || undefined;
  } else {
    const requestedEmail = normalizeEmail(typeof data?.email === "string" ? data.email : "");
    if (!requestedEmail) {
      throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني مطلوب");
    }
    try {
      const user = await admin.auth().getUserByEmail(requestedEmail);
      if (user.emailVerified) {
        return { sent: true };
      }
      uid = user.uid;
      email = user.email!;
      name = user.displayName || undefined;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "auth/user-not-found") {
        console.error("[sendEmailVerificationOtp] فشل غير متوقع:", err);
      }
      return { sent: true };
    }
  }

  const otp = generateOtp();
  await verifyEmailOtpRef(uid).set({
    hash: hashOtp(otp),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
    attempts: 0,
  });

  const { subject, html } = verifyEmailOtpTemplate(otp, name);
  await sendMail({ to: email, subject, html });
  return { sent: true };
});

/**
 * ✅ بلا context.auth عمداً (خلافاً لـsendEmailVerificationOtp أعلاه):
 * التسجيل يسجّل خروج المستخدم فوراً بعد إرسال الرمز (التحقق إجباري قبل أي
 * دخول فعلي — راجع registerWithEmail بـFirestoreRepository.kt بأندرويد)،
 * فشاشة إدخال الرمز تعمل دائماً بلا جلسة مسجَّلة. البريد + الرمز نفسه هما
 * إثبات الملكية هنا (نفس منطق confirmPasswordResetOtp بالأسفل تماماً).
 */
export const confirmEmailVerificationOtp = functionsV1.https.onCall(async (data) => {
  const email = normalizeEmail(typeof data?.email === "string" ? data.email : "");
  const otp = typeof data?.otp === "string" ? data.otp.trim() : "";
  if (!email || !otp) {
    throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني والرمز مطلوبان");
  }

  let uid: string;
  try {
    uid = (await admin.auth().getUserByEmail(email)).uid;
  } catch {
    throw new functionsV1.https.HttpsError("invalid-argument", "رمز التأكيد غير صحيح");
  }

  await verifyAndConsumeOtp(verifyEmailOtpRef(uid), otp);
  await admin.auth().updateUser(uid, { emailVerified: true });
  return { verified: true };
});

// ─── استعادة كلمة المرور برمز ────────────────────────────────────────────

function passwordResetOtpRef(normalizedEmail: string) {
  return db.collection("passwordResetOtps").doc(emailKey(normalizedEmail));
}

export const sendPasswordResetOtp = functionsV1.https.onCall(async (data) => {
  const rawEmail = typeof data?.email === "string" ? data.email : "";
  const email = normalizeEmail(rawEmail);
  if (!email) {
    throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني مطلوب");
  }

  try {
    await admin.auth().getUserByEmail(email);
    const otp = generateOtp();
    await passwordResetOtpRef(email).set({
      hash: hashOtp(otp),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
      attempts: 0,
    });
    const { subject, html } = resetPasswordOtpTemplate(otp);
    await sendMail({ to: email, subject, html });
  } catch (err: unknown) {
    // ✅ نفس منطق sendPasswordResetEmailCustom: لا نكشف للمستخدم إن كان
    // البريد مسجَّلاً من عدمه — الاستجابة نفسها دائماً بصرف النظر عن النتيجة.
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[sendPasswordResetOtp] فشل غير متوقع:", err);
    }
  }
  return { sent: true };
});

export const confirmPasswordResetOtp = functionsV1.https.onCall(async (data) => {
  const email = normalizeEmail(typeof data?.email === "string" ? data.email : "");
  const otp = typeof data?.otp === "string" ? data.otp.trim() : "";
  const newPassword = typeof data?.newPassword === "string" ? data.newPassword : "";

  if (!email || !otp) {
    throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني والرمز مطلوبان");
  }
  if (newPassword.length < 8) {
    throw new functionsV1.https.HttpsError("invalid-argument", "كلمة المرور يجب أن تكون 8 أحرف على الأقل");
  }

  await verifyAndConsumeOtp(passwordResetOtpRef(email), otp);

  // ✅ الرمز صحيح ومرتبط بالبريد فقط (لا uid) — نبحث عن المستخدم الآن، بعد
  // التأكد من الرمز، حتى لا نكشف بوجود/عدم وجود الحساب من زمن استجابة
  // مختلف بمرحلة سابقة (الفحص الحقيقي الوحيد حدث بالفعل أعلاه بالرمز).
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().updateUser(user.uid, { password: newPassword });
  return { reset: true };
});
