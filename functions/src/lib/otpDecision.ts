import * as crypto from "crypto";
import { hashOtp } from "./otp";

// ELEVEN STORE — القرار النقي للتحقق من OTP (بلا Firestore/firebase-admin) لسهولة الاختبار.
// المعاملة الذرّية التي تستهلكه بـotpVerify.ts.
export const MAX_OTP_ATTEMPTS = 5;

export interface OtpRecord {
  hash: string;
  expiresAt: { toMillis(): number };
  attempts?: number;
}

export type OtpCheck = "ok" | "missing" | "expired" | "locked" | "wrong";

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** قرار نقي (بلا Firestore) — قابل للاختبار مباشرة. */
export function evaluateOtp(
  record: OtpRecord | null,
  otp: string,
  now: number,
  maxAttempts: number = MAX_OTP_ATTEMPTS,
): OtpCheck {
  if (!record) return "missing";
  if (record.expiresAt.toMillis() < now) return "expired";
  if ((record.attempts ?? 0) >= maxAttempts) return "locked";
  return safeEqualHex(hashOtp(otp), record.hash) ? "ok" : "wrong";
}
