// ELEVEN STORE — سجل أخطاء النظام (نسخة Cloud Functions)
// ─────────────────────────────────────────────────────────────────────────
// نفس منطق server/error-log-service.ts بالضبط، بنفس اسم المجموعة
// "systemErrorLogs" — نسخة مستقلة هنا لأن functions/ حزمة TS/بناء منفصلة
// تماماً عن panel/server/ (لا يوجد استيراد مشترك بين الحزمتين بهذا المشروع،
// راجع functions/tsconfig.json). هذه النسخة تُستخدم فقط من reportClientError
// (callable) — أخطاء تطبيق الأندرويد، لأنه يتصل بـCloud Functions مباشرة،
// لا بسيرفر Express بلوحة التحكم.
import * as admin from "firebase-admin";
import { db } from "./admin";
import crypto from "crypto";

export type ErrorLogSeverity = "fatal" | "error" | "warning";

export interface ReportErrorInput {
  message: string;
  stack?: string;
  route?: string;
  userId?: string;
  userEmail?: string;
  appVersion?: string;
  deviceInfo?: string;
  severity?: ErrorLogSeverity;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// ✅ ملاحظة: Cloud Functions قد يُنفَّذ كل استدعاء بنسخة (instance) مختلفة،
// فخريطة الذاكرة هذه ليست موثوقة 100% للـdedup هنا (بخلاف server/ أحادي
// الـinstance) — لكنها لا تزال تقلّل الفيضان فعلياً ضمن نفس الـinstance
// (Cloud Functions يُعيد استخدام نفس الـinstance لاستدعاءات متتالية سريعة
// غالباً)، وأي تكرار عابر للحدود بين الـinstances يبقى مجرد مستند إضافي
// بدل عطل — أثر جانبي مقبول، وليس ثغرة أمان أو صحّة بيانات.
const recentHashes = new Map<string, { docId: string; count: number; lastAt: number }>();

function hashOf(message: string): string {
  return crypto.createHash("sha1").update(`android:${message}`).digest("hex");
}

export async function logAndroidError(input: ReportErrorInput): Promise<void> {
  try {
    const message = (input.message || "خطأ غير معروف").slice(0, MAX_MESSAGE_LEN);
    const stack = input.stack ? input.stack.slice(0, MAX_STACK_LEN) : null;
    const hash = hashOf(message);
    const now = Date.now();
    const existing = recentHashes.get(hash);

    if (existing && now - existing.lastAt < DEDUP_WINDOW_MS) {
      existing.count += 1;
      existing.lastAt = now;
      await db.collection("systemErrorLogs").doc(existing.docId).set(
        { count: existing.count, lastSeenAt: admin.firestore.Timestamp.now() },
        { merge: true }
      );
      return;
    }

    const docRef = db.collection("systemErrorLogs").doc();
    recentHashes.set(hash, { docId: docRef.id, count: 1, lastAt: now });
    await docRef.set({
      source: "android",
      message,
      stack,
      route: input.route ?? null,
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      appVersion: input.appVersion ?? null,
      deviceInfo: input.deviceInfo ?? null,
      severity: input.severity ?? "error",
      count: 1,
      resolved: false,
      createdAt: admin.firestore.Timestamp.now(),
      lastSeenAt: admin.firestore.Timestamp.now(),
    });
  } catch (loggingError) {
    console.error("[error-log-service:functions] فشل تسجيل الخطأ:", loggingError);
  }
}
