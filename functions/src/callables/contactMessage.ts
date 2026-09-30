import * as functionsV1 from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { db } from "../lib/admin";
import { checkRateLimitFirestore } from "../lib/rateLimit";

/**
 * إرسال رسالة "تواصل معنا" عبر السيرفر بدل الكتابة المباشرة على Firestore.
 *
 * السبب: قاعدة الإنشاء القديمة كانت مفتوحة للجميع بلا تسجيل دخول ولا حد للمعدل، والحماية
 * الوحيدة كانت trigger يحذف الرسالة بعد كتابتها (contactMessageTriggers.ts). الآن يُرفض
 * الإغراق قبل الكتابة (حد لكل IP وحد لكل مرسِل)، والقواعد تمنع الكتابة المباشرة.
 * يبقى الـtrigger كخط دفاع ثانٍ (حد عام للمتجر كله + تنبيه الأدمن).
 */

const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number, required: boolean, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if ((required && s.length === 0) || s.length > max) {
    throw new functionsV1.https.HttpsError("invalid-argument", `${label} غير صالح`);
  }
  return s;
}

export const submitContactMessage = functionsV1
  .runWith({ enforceAppCheck })
  .https.onCall(async (data, context) => {
    const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const name = str(d.name, 100, true, "الاسم");
    const email = str(d.email, 200, true, "البريد الإلكتروني");
    const subject = str(d.subject, 200, false, "الموضوع");
    const message = str(d.message, 3000, true, "الرسالة");
    if (!EMAIL_RE.test(email)) {
      throw new functionsV1.https.HttpsError("invalid-argument", "البريد الإلكتروني غير صالح");
    }

    const uid = context.auth?.uid ?? null;
    const ip = context.rawRequest?.ip ?? "unknown";
    const senderKey = uid ?? email.toLowerCase();

    const [ipOk, senderOk] = await Promise.all([
      checkRateLimitFirestore(`contact-submit-ip:${ip}`, 5, 10 * 60 * 1000),
      checkRateLimitFirestore(`contact-submit-sender:${senderKey}`, 3, 10 * 60 * 1000),
    ]);
    if (!ipOk || !senderOk) {
      throw new functionsV1.https.HttpsError("resource-exhausted", "أرسلت رسائل كثيرة، حاول مرة أخرى لاحقاً");
    }

    await db.collection("contactMessages").add({
      name,
      email,
      subject,
      message,
      userId: uid,
      status: "new",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { sent: true };
  });
