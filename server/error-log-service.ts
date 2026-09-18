// ELEVEN STORE — سجل أخطاء النظام المركزي (لوحة التحكم + الأندرويد + السيرفر)
// ─────────────────────────────────────────────────────────────────────────
// ✅ إضافة (بطلب الأدمن): "كل أخطاء اللوحة والتطبيق أريدها تظهر لي في اللوحة
// لكي يراها الأدمن فقط". هذا الملف نقطة التجميع الوحيدة — كل مصدر (السيرفر
// نفسه، لوحة التحكم بالمتصفح، تطبيق الأندرويد) يكتب هنا فقط، ويُقرأ فقط
// من صفحة "سجل الأخطاء" بلوحة التحكم (adminProcedure — أدمن فقط، كما طُلب).
//
// ✅ قرار تصميم مهم: القراءة والكتابة كلاهما يمران بهذا السيرفر (Admin SDK)
// عبر tRPC، وليس بـFirestore Client SDK مباشرة من أي طرف — بعد حادثة تعطّل
// الإشعارات بسبب App Check Enforce، تعمّدنا ألا تعتمد ميزة جديدة على توفر
// App Check توكن صحيح؛ راجع firestore.rules: مجموعة systemErrorLogs مرفوضة
// كلياً من أي عميل مباشر (قراءة وكتابة)، فلا closure على هذه الحادثة نفسها.
import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import crypto from "crypto";

export type ErrorLogSource = "panel" | "server" | "android";
export type ErrorLogSeverity = "fatal" | "error" | "warning";

export interface ReportErrorInput {
  source: ErrorLogSource;
  message: string;
  stack?: string;
  route?: string; // مسار/شاشة لوحة التحكم، أو مسار Express، أو شاشة الأندرويد
  userId?: string;
  userEmail?: string;
  appVersion?: string; // نسخة تطبيق الأندرويد وقت الحدوث
  deviceInfo?: string; // موديل الجهاز/نسخة النظام (أندرويد فقط)
  severity?: ErrorLogSeverity;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 دقائق — نفس الخطأ المتكرر خلالها يُجمَّع بعدّاد بدل مستند جديد

// ✅ نمط مطابق لـrateLimit.ts (خريطة بالذاكرة، تنظيف دوري) — يمنع حلقة خطأ
// متكررة (مثال: فشل onSnapshot يعيد المحاولة كل ثانية) من إنشاء آلاف
// المستندات المتطابقة بدقائق قليلة.
const recentHashes = new Map<string, { docId: string; count: number; lastAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of recentHashes) {
    if (now - val.lastAt > DEDUP_WINDOW_MS) recentHashes.delete(key);
  }
}, 10 * 60 * 1000).unref();

function hashOf(source: ErrorLogSource, message: string): string {
  return crypto.createHash("sha1").update(`${source}:${message}`).digest("hex");
}

/**
 * يسجّل خطأً واحداً بمجموعة systemErrorLogs. لا يرمي أبداً — فشل تسجيل
 * الخطأ نفسه لا يجب أن يسبب خطأ ثانياً غير معالج بمسار المستخدم الأصلي.
 */
export async function logSystemError(db: Firestore, input: ReportErrorInput): Promise<void> {
  try {
    const message = (input.message || "خطأ غير معروف").slice(0, MAX_MESSAGE_LEN);
    const stack = input.stack ? input.stack.slice(0, MAX_STACK_LEN) : null;
    const hash = hashOf(input.source, message);
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
      source: input.source,
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
    console.error("[error-log-service] فشل تسجيل الخطأ:", loggingError);
  }
}
