import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { adminAuth, adminDb } from "../firebase-admin";
import { ENV } from "./env";
import { readCookie, verifySession, SESSION_COOKIE_NAME } from "./session";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@shared/adminPermissions";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: any | null;
};

// ✅ نظام أدمنز متعدد (بعد أن كان هناك أدمن واحد فقط عبر OWNER_OPEN_ID ثابت):
// - "السوبر أدمن" هو صاحب المتجر (OWNER_OPEN_ID) دائماً وبكل الصلاحيات —
//   بغض النظر عمّا هو مخزَّن في Firestore، حتى لا يُحبَس صاحب المتجر خارج
//   لوحته أبداً (مثال: لو حصل خطأ بكتابة مستند المستخدم بالخطأ).
// - أي أدمن آخر: يُحدَّد بحقل users/{uid}.role == "admin" (نفس الحقل الذي
//   تتحقق منه firestore.rules أصلاً لتطبيق الأندرويد)، وصلاحياته الفعلية من
//   users/{uid}.adminPermissions (مصفوفة من AdminPermission). هذا يضيف قراءة
//   واحدة إضافية من Firestore لكل طلب لمستخدم غير السوبر أدمن — تكلفة معقولة
//   مقابل دعم أدمنز حقيقيين متعددين.
async function buildUser(uid: string, email?: string | null, name?: string | null) {
  const isSuperAdmin = Boolean(ENV.ownerOpenId) && uid === ENV.ownerOpenId;

  if (isSuperAdmin) {
    return {
      id: uid,
      openId: uid,
      email: email ?? undefined,
      name: name ?? undefined,
      role: "admin" as const,
      isSuperAdmin: true,
      permissions: [...ADMIN_PERMISSIONS] as AdminPermission[],
    };
  }

  let role: "admin" | "user" = "user";
  let permissions: AdminPermission[] = [];
  let disabled = false;

  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    const data = snap.data();
    if (data?.role === "admin") {
      role = "admin";
      const stored = Array.isArray(data.adminPermissions) ? data.adminPermissions : [];
      permissions = stored.filter((p: unknown): p is AdminPermission =>
        typeof p === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(p)
      );
    }
    disabled = Boolean(data?.disabled);
  } catch (error) {
    console.error("[tRPC Context] فشل قراءة دور المستخدم من Firestore:", error);
  }

  return {
    id: uid,
    openId: uid,
    email: email ?? undefined,
    name: name ?? undefined,
    role: disabled ? ("user" as const) : role,
    isSuperAdmin: false,
    permissions: disabled ? [] : permissions,
  };
}

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
