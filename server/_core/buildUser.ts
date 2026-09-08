import { adminDb } from "../firebase-admin";
import { ENV } from "./env";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@shared/adminPermissions";

export type AppUser = {
  id: string;
  openId: string;
  email?: string;
  name?: string;
  role: "admin" | "user";
  isSuperAdmin: boolean;
  permissions: AdminPermission[];
};

// ✅ مصدر حقيقة واحد لبناء بيانات المستخدم (الدور/الصلاحيات/isSuperAdmin)،
// مستخدَم من كلا المسارين اللذين يحتاجانه: سياق tRPC (context.ts) ونقطة
// /api/session/whoami (sessionRoutes.ts). قبل هذا الاستخراج كانت
// sessionRoutes.ts تحسب الدور بمنطق منفصل ومختصر (roleFor)، وهو ما سبّب
// خللاً مشابهاً سابقاً (راجع تعليق الإصلاح القديم بـsessionRoutes.ts) — دالة
// واحدة مشتركة تمنع تكرار هذا الصنف من الأخطاء نهائياً، لأنه ببساطة لا يوجد
// منطق ثانٍ يمكن أن ينحرف عن الأول.
//
// "السوبر أدمن" هو صاحب المتجر (OWNER_OPEN_ID) دائماً وبكل الصلاحيات — بغض
// النظر عمّا هو مخزَّن بـFirestore، حتى لا يُحبَس صاحب المتجر خارج لوحته أبداً.
// أي أدمن آخر: يُحدَّد بحقل users/{uid}.role == "admin" وصلاحياته الفعلية من
// users/{uid}.adminPermissions.
export async function buildUser(
  uid: string,
  email?: string | null,
  name?: string | null
): Promise<AppUser> {
  const isSuperAdmin = Boolean(ENV.ownerOpenId) && uid === ENV.ownerOpenId;

  if (isSuperAdmin) {
    return {
      id: uid,
      openId: uid,
      email: email ?? undefined,
      name: name ?? undefined,
      role: "admin",
      isSuperAdmin: true,
      permissions: [...ADMIN_PERMISSIONS],
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
    console.error("[buildUser] فشل قراءة دور المستخدم من Firestore:", error);
  }

  return {
    id: uid,
    openId: uid,
    email: email ?? undefined,
    name: name ?? undefined,
    role: disabled ? "user" : role,
    isSuperAdmin: false,
    permissions: disabled ? [] : permissions,
  };
}
