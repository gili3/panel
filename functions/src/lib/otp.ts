import * as crypto from "crypto";

/** رمز تأكيد من 6 أرقام (100000–999999) — عبر crypto.randomInt الآمن تشفيرياً */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * لا نُخزّن الرمز نفسه في Firestore أبداً — فقط بصمة SHA-256 له. لو تسرّبت
 * قاعدة البيانات (أو اطّلع عليها أي طرف بصلاحيات إدارية)، لا يمكن استخراج
 * الرمز الفعلي منها.
 */
export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}
