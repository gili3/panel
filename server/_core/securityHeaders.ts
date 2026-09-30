import type { NextFunction, Request, Response } from "express";

/**
 * ترويسات أمان أساسية بلا أي اعتماد خارجي (بديل خفيف عن helmet). لم تكن موجودة إطلاقاً، فكانت
 * اللوحة قابلة للتضمين بـiframe من أي موقع (clickjacking على أزرار الأدمن) ويُسمح للمتصفح بتخمين
 * أنواع الملفات.
 *
 * مقصود عدم ضبط:
 *  - Cross-Origin-Opener-Policy: يكسر تسجيل الدخول بنافذة Google المنبثقة (signInWithPopup).
 *  - Content-Security-Policy: اللوحة تحمّل خرائط وFirebase وخطوطاً من نطاقات متعددة؛ سياسة خاطئة
 *    تُعطّل الواجهة. تُضاف لاحقاً بوضع Report-Only أولاً بعد جرد النطاقات فعلياً.
 */
export function securityHeaders(options: { production: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=()");

    // HSTS فقط بالإنتاج وعلى اتصال HTTPS فعلاً (خلف البروكسي: x-forwarded-proto)
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (options.production && isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  };
}
