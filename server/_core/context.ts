import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { adminAuth } from "../firebase-admin";
import { readCookie, verifySession, SESSION_COOKIE_NAME } from "./session";
import { buildUser } from "./buildUser";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: any | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: any | null = null;

  try {
    // ✅ إصلاح أداء (تسريع الجلسة): المسار الأساسي الآن هو كوكي الجلسة
    // httpOnly (fb_session) بدل انتظار هيدر Authorization: Bearer <idToken>
    // من الواجهة مع كل طلب. الكوكي يصل تلقائياً مع الطلب، فلا حاجة لأي
    // انتظار جانب المتصفح (لا Firebase SDK init، لا getIdToken() في كل مرة).
    const sessionCookie = readCookie(opts.req, SESSION_COOKIE_NAME);

    if (sessionCookie) {
      const decoded = await verifySession(sessionCookie);
      user = await buildUser(decoded.uid, decoded.email, decoded.name);
    } else {
      // مسار احتياطي (توافقية فقط): يدعم أي طلب لا يحمل الكوكي بعد (مثال:
      // اللحظة الأولى قبل اكتمال /api/session/login) عبر هيدر Bearer القديم.
      const authHeader = opts.req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        user = await buildUser(decodedToken.uid, decodedToken.email, decodedToken.name);
      }
    }
  } catch (error) {
    console.error("[tRPC Context] Auth Error:", error);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
