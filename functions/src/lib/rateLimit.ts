import * as admin from "firebase-admin";
import { db } from "./admin";

/**
 * ✅ إصلاح: دوال OTP (otpAuth.ts) كانت بلا أي تحديد لمعدل الطلبات، خلافاً
 * لنظيراتها في السيرفر (server/_core/rateLimit.ts). الفرق المهم هنا: تلك
 * النسخة تستخدم Map في الذاكرة، وهذا يصلح لسيرفر Express بنسخة واحدة (single
 * instance)، لكنه لا يصلح إطلاقاً لـ Cloud Functions — كل استدعاء قد يُنفَّذ
 * على نسخة (instance) مختلفة تماماً بذاكرة منفصلة، فالعداد لن يكون موثوقاً.
 * لذلك نستخدم هنا مستند Firestore واحد لكل مفتاح، ونحدّثه ضمن transaction.
 *
 * بلا هذا التحديد: أي شخص يقدر يستدعي sendPasswordResetOtp/
 * sendEmailVerificationOtp ببريد أي شخص آخر بلا حدود — إغراق بريده برسائل
 * (ومستهلك رصيد Resend المدفوع) بلا أي تكلفة على المهاجم.
 */
export async function checkRateLimitFirestore(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const ref = db.collection("_rateLimits").doc(key);
  const now = Date.now();

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as { count: number; resetAt: number }) : null;

    if (!data || data.resetAt <= now) {
      tx.set(ref, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (data.count >= max) {
      return false;
    }

    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
    return true;
  });
}
