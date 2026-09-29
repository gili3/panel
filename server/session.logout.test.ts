import { describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { registerSessionRoutes } from "./_core/sessionRoutes";
import { SESSION_COOKIE_NAME } from "./_core/session";

// ✅ إعادة كتابة كاملة (Audit المرحلة 16، بند 16.1): الاختبار الأصلي كان
// يستدعي `appRouter.createCaller(ctx).auth.logout()` — إجراء tRPC غير
// موجود إطلاقاً بالمشروع الفعلي (`routers.ts` لا يحوي سوى `auth.me`).
// تسجيل الخروج الحقيقي بهذا المشروع يمر حصراً عبر مسار Express عادي
// (`POST /api/session/logout` بـ`sessionRoutes.ts`)، وليس عبر tRPC. أي
// تشغيل فعلي للاختبار القديم كان يفشل فوراً بخطأ "auth.logout is not a
// function". هذا الاختبار الجديد يفحص المسار الحقيقي فعلياً (خادم HTTP
// حقيقي على منفذ عشوائي، بلا أي محاكاة/mock لمنطق الكوكي) بدل محاكاة سياق
// وهمي غير مطابق للمعمارية الفعلية — بلا أي تبعية اختبار جديدة (فقط
// http/fetch المدمجين بـNode).

function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app);
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("POST /api/session/logout", () => {
  it("يمسح كوكي الجلسة فعلياً ويُرجع نجاح العملية (سيناريو إنتاج عبر HTTPS)", async () => {
    const { server, baseUrl } = await startTestServer();
    try {
      // x-forwarded-proto: https يحاكي طلباً حقيقياً خلف بروكسي المنصة
      // بالإنتاج (راجع _core/index.ts::trust proxy) — نتوقّع هنا secure=true
      // وsameSite=none تحديداً، بعكس تطوير محلي عادي عبر http (lax).
      const res = await fetch(`${baseUrl}/api/session/logout`, {
        method: "POST",
        headers: { "x-forwarded-proto": "https" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      const setCookieHeaders =
        typeof (res.headers as any).getSetCookie === "function"
          ? (res.headers as any).getSetCookie()
          : [res.headers.get("set-cookie") || ""];

      const sessionCookieHeader = setCookieHeaders.find((h: string) =>
        h.startsWith(`${SESSION_COOKIE_NAME}=`)
      );
      expect(sessionCookieHeader).toBeDefined();
      expect(sessionCookieHeader).toMatch(/HttpOnly/i);
      expect(sessionCookieHeader).toMatch(/Secure/i);
      expect(sessionCookieHeader).toMatch(/SameSite=None/i);
      expect(sessionCookieHeader).toMatch(/Path=\//i);
      // كوكي مُلغى فعلياً: تاريخ انتهاء بالماضي (Expires) — هذا ما يفعله
      // express.clearCookie() داخلياً بدل الاعتماد على قيمة maxAge وهمية.
      expect(sessionCookieHeader).toMatch(/Expires=/i);
    } finally {
      server.close();
    }
  });

  it("يستخدم SameSite=Lax (لا Secure) على اتصال http عادي غير مشفَّر (تطوير محلي)", async () => {
    const { server, baseUrl } = await startTestServer();
    try {
      const res = await fetch(`${baseUrl}/api/session/logout`, { method: "POST" });
      const setCookieHeaders =
        typeof (res.headers as any).getSetCookie === "function"
          ? (res.headers as any).getSetCookie()
          : [res.headers.get("set-cookie") || ""];
      const sessionCookieHeader = setCookieHeaders.find((h: string) =>
        h.startsWith(`${SESSION_COOKIE_NAME}=`)
      );
      expect(sessionCookieHeader).toBeDefined();
      expect(sessionCookieHeader).toMatch(/SameSite=Lax/i);
      expect(sessionCookieHeader).not.toMatch(/Secure/i);
    } finally {
      server.close();
    }
  });
});
