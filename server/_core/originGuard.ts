import type { NextFunction, Request, Response } from "express";

// ELEVEN STORE — حماية CSRF (طبقة دفاع إضافية) لطلبات الكتابة على /api/trpc و/api/session
// ─────────────────────────────────────────────────────────────────────────
// كوكي الجلسة SameSite=None (يلزم لـCapacitor/origins مختلفة، راجع cookies.ts) فيُرسَل
// مع أي طلب عابر للمواقع. الاعتماد الوحيد كان على سلوك tRPC (رفض text/plain) وCORS
// (يمنع القراءة لا الإرسال). المتصفحات ترسل دائماً ترويسة Origin مع POST/PUT/DELETE/PATCH
// عابر للمواقع، فنرفض أي Origin غير معروف. القواعد:
//  • لا Origin (تطبيق الأندرويد الأصلي، curl، خادم-لخادم) → مسموح (لا كوكي متصفح فيها).
//  • Origin ضمن القائمة البيضاء → مسموح.
//  • Origin مطابق لمضيف الخادم نفسه (نفس الموقع) → مسموح، حتى لا نكسر اللوحة لو كان
//    نطاقها غير مدرج بالقائمة (متصفح لا يستطيع تزوير Host لطلب عابر للمواقع).
//  • غير ذلك → 403.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  requestHosts: readonly (string | undefined)[],
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // Origin غير صالح (مثل "null" من iframe sandbox) → مرفوض
  }
  return requestHosts.some((h) => !!h && h.toLowerCase() === originHost.toLowerCase());
}

export function originGuard(allowedOrigins: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    const forwardedHost = req.headers["x-forwarded-host"];
    const hosts = [
      req.headers.host,
      Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost?.split(",")[0]?.trim(),
    ];
    if (isOriginAllowed(req.headers.origin, allowedOrigins, hosts)) return next();
    console.warn(`[originGuard] رُفض طلب ${req.method} ${req.path} من Origin غير موثوق`);
    res.status(403).json({ error: "Origin not allowed" });
  };
}
