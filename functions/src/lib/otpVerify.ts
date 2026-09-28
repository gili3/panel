import * as admin from "firebase-admin";
import * as functionsV1 from "firebase-functions/v1";
import { db } from "./admin";
import { evaluateOtp, MAX_OTP_ATTEMPTS, type OtpCheck, type OtpRecord } from "./otpDecision";

export { evaluateOtp, MAX_OTP_ATTEMPTS };
export type { OtpCheck, OtpRecord };

// ELEVEN STORE — التحقق من رمز OTP واستهلاكه (مصدر واحد لكل مسارات OTP)
// ─────────────────────────────────────────────────────────────────────────
// الثغرة التي أُغلقت: كان التحقق "اقرأ المستند ← قارن ← زد العدّاد" بلا معاملة. طلبات
// تخمين متوازية (مئات دفعة واحدة) تقرأ كلها attempts=0 قبل أن يزيده أي منها، فيتجاوز
// المهاجم الحد الأقصى للمحاولات (5) لكل دفعة، وبتكرار طلب رمز جديد (بلا حد على مسار حذف
// الحساب) يزداد احتمال إصابة الرمز ذي الـ6 أرقام. الآن كل محاولة تُنفَّذ داخل معاملة
// Firestore: تُسلسَل المحاولات المتزامنة، ويُحتسب الفشل قبل أي محاولة تالية.
export async function verifyAndConsumeOtp(
  ref: admin.firestore.DocumentReference,
  otp: string,
): Promise<void> {
  const outcome = await db.runTransaction(async (tx): Promise<OtpCheck> => {
    const snap = await tx.get(ref);
    const result = evaluateOtp(snap.exists ? (snap.data() as OtpRecord) : null, otp, Date.now());
    if (result === "ok" || result === "expired" || result === "locked") {
      tx.delete(ref);
    } else if (result === "wrong") {
      tx.update(ref, { attempts: admin.firestore.FieldValue.increment(1) });
    }
    return result;
  });

  switch (outcome) {
    case "ok":
      return;
    case "missing":
      throw new functionsV1.https.HttpsError(
        "failed-precondition",
        "لم يتم طلب رمز تأكيد بعد، يرجى المحاولة من البداية",
      );
    case "expired":
      throw new functionsV1.https.HttpsError("deadline-exceeded", "انتهت صلاحية الرمز، يرجى طلب رمز جديد");
    case "locked":
      throw new functionsV1.https.HttpsError(
        "resource-exhausted",
        "عدد محاولات كبير جداً، يرجى طلب رمز جديد",
      );
    default:
      throw new functionsV1.https.HttpsError("invalid-argument", "رمز التأكيد غير صحيح");
  }
}
