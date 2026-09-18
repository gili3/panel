import { trpcVanilla } from "./trpcVanilla";

/**
 * ELEVEN STORE — إبلاغ أخطاء لوحة التحكم للسجل المركزي (بطلب الأدمن)
 * ─────────────────────────────────────────────────────────
 * يجمع كل خطأ غير مُلتقَط بالمتصفح (سكريبت، Promise مرفوض بلا catch،
 * ErrorBoundary) ويرسله لـerrorLog.reportError بالسيرفر — "fire and forget"
 * عمداً: فشل إرسال تقرير الخطأ نفسه لا يجب أن يُنتج خطأً ثانياً بواجهة
 * المستخدم (catch صامت أدناه).
 */
let installed = false;
const reportedRecently = new Set<string>();

export function reportPanelError(
  message: string,
  options?: { stack?: string; route?: string; severity?: "fatal" | "error" | "warning" }
): void {
  // منع إغراق نفس الخطأ داخل تبويب واحد بعشرات الطلبات بثوانٍ معدودة (مثال:
  // حلقة render تفشل بتكرار) — التجميع الحقيقي عبر عدّاد count يتم بالسيرفر
  // (error-log-service.ts)، هذا فقط يمنع طلبات شبكة زائدة من نفس التبويب.
  const dedupeKey = `${message}`.slice(0, 200);
  if (reportedRecently.has(dedupeKey)) return;
  reportedRecently.add(dedupeKey);
  setTimeout(() => reportedRecently.delete(dedupeKey), 30_000);

  trpcVanilla.errorLog.reportError
    .mutate({
      source: "panel",
      message: message.slice(0, 2000),
      stack: options?.stack?.slice(0, 8000),
      route: options?.route ?? window.location.pathname,
      severity: options?.severity ?? "error",
    })
    .catch(() => {
      // صامت عمداً — راجع التعليق أعلى الملف.
    });
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق (main.tsx) لتركيب المستمعين العامّين. */
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportPanelError(event.message || "خطأ سكريبت غير معروف", {
      stack: event.error?.stack,
      severity: "error",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportPanelError(message || "Promise مرفوض بلا معالجة", { stack, severity: "error" });
  });
}
