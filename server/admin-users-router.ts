// إدارة المستخدمين من لوحة التحكم: عرض/بحث، ترقية/تنزيل لصلاحية أدمن،
// تعديل الصلاحيات التفصيلية، وحظر/فك حظر حساب.
//
// ⚠️ ترقية/تنزيل الأدمنز أنفسهم (setAdminStatus, updateAdminPermissions,
// listAdmins) محصورة بـsuperAdminProcedure (صاحب المتجر فقط) — أدمن عادي
// حتى لو عنده صلاحية "users" يقدر يشوف/يحظر المستخدمين العاديين، لكن مايقدرش
// يرقّي حد لأدمن أو يعدّل صلاحيات أدمن آخر (يمنع تصعيد صلاحيات ذاتي).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAuth, adminDb } from "./firebase-admin";
import { router, adminPermission, superAdminProcedure } from "./_core/trpc";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@shared/adminPermissions";
import { ENV } from "./_core/env";

const permissionSchema = z.enum(ADMIN_PERMISSIONS as unknown as [AdminPermission, ...AdminPermission[]]);

export const adminUsersRouter = router({
  // قائمة مستخدمين مُصفّحة (عبر pageToken من Firebase Auth) — مع دمج دور
  // وصلاحيات كل مستخدم من مستند Firestore المطابق إن وُجد.
  getUsers: adminPermission("users")
    .input(z.object({ pageToken: z.string().nullish() }).optional())
    .query(async ({ input }) => {
      const result = await adminAuth.listUsers(20, input?.pageToken ?? undefined);
      const uids = result.users.map(u => u.uid);
      const docs = uids.length
        ? await adminDb.getAll(...uids.map(uid => adminDb.collection("users").doc(uid)))
        : [];
      const dataByUid = new Map(docs.map(d => [d.id, d.data()]));

      const users = result.users.map(u => {
        const data = dataByUid.get(u.uid);
        return {
          uid: u.uid,
          email: u.email ?? null,
          name: data?.name || u.displayName || null,
          phone: data?.phone || u.phoneNumber || null,
          disabled: u.disabled,
          role: (u.uid === ENV.ownerOpenId ? "admin" : data?.role === "admin" ? "admin" : "user") as "admin" | "user",
          isSuperAdmin: u.uid === ENV.ownerOpenId,
          adminPermissions: Array.isArray(data?.adminPermissions) ? data.adminPermissions : [],
          createdAt: u.metadata.creationTime,
          lastSignInAt: u.metadata.lastSignInTime,
        };
      });

      return { users, nextPageToken: result.pageToken ?? null };
    }),

  // بحث ببريد إلكتروني محدد (Firebase Auth بيدعم بحث دقيق بالبريد فقط —
  // لا يوجد بحث جزئي/prefix بدون خدمة فهرسة خارجية زي Algolia).
  findUserByEmail: adminPermission("users")
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      try {
        const u = await adminAuth.getUserByEmail(input.email);
        const doc = await adminDb.collection("users").doc(u.uid).get();
        const data = doc.data();
        return {
          uid: u.uid,
          email: u.email ?? null,
          name: data?.name || u.displayName || null,
          phone: data?.phone || u.phoneNumber || null,
          disabled: u.disabled,
          role: (u.uid === ENV.ownerOpenId ? "admin" : data?.role === "admin" ? "admin" : "user") as "admin" | "user",
          isSuperAdmin: u.uid === ENV.ownerOpenId,
          adminPermissions: Array.isArray(data?.adminPermissions) ? data.adminPermissions : [],
        };
      } catch {
        return null;
      }
    }),

  // حظر / فك حظر حساب (يمنع تسجيل الدخول فعليًا عبر Firebase Auth، وليس
  // فقط إخفاءً بالواجهة).
  setUserDisabled: adminPermission("users")
    .input(z.object({ uid: z.string(), disabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.uid === ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن حظر صاحب المتجر" });
      }
      await adminAuth.updateUser(input.uid, { disabled: input.disabled });
      await adminDb.collection("users").doc(input.uid).set(
        { disabled: input.disabled },
        { merge: true }
      );
      return { success: true };
    }),

  // ترقية مستخدم لأدمن أو تنزيله — صاحب المتجر فقط.
  setAdminStatus: superAdminProcedure
    .input(z.object({
      uid: z.string(),
      isAdmin: z.boolean(),
      permissions: z.array(permissionSchema).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.uid === ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "صاحب المتجر أدمن دائماً بكل الصلاحيات" });
      }
      await adminDb.collection("users").doc(input.uid).set(
        {
          role: input.isAdmin ? "admin" : "user",
          adminPermissions: input.isAdmin ? (input.permissions ?? []) : [],
        },
        { merge: true }
      );
      return { success: true };
    }),

  // تعديل صلاحيات أدمن موجود بالفعل.
  updateAdminPermissions: superAdminProcedure
    .input(z.object({ uid: z.string(), permissions: z.array(permissionSchema) }))
    .mutation(async ({ input }) => {
      if (input.uid === ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "صاحب المتجر يملك كل الصلاحيات دائماً" });
      }
      await adminDb.collection("users").doc(input.uid).set(
        { adminPermissions: input.permissions },
        { merge: true }
      );
      return { success: true };
    }),

  // قائمة الأدمنز الحاليين فقط (لعرضهم/تعديلهم بسرعة دون تصفح كل المستخدمين).
  listAdmins: superAdminProcedure.query(async () => {
    const snapshot = await adminDb.collection("users").where("role", "==", "admin").get();
    const admins = await Promise.all(
      snapshot.docs.map(async doc => {
        const data = doc.data();
        let email: string | null = null;
        try {
          const authUser = await adminAuth.getUser(doc.id);
          email = authUser.email ?? null;
        } catch {
          email = null;
        }
        return {
          uid: doc.id,
          email,
          name: data.name || null,
          adminPermissions: Array.isArray(data.adminPermissions) ? data.adminPermissions : [],
          disabled: Boolean(data.disabled),
        };
      })
    );
    return admins;
  }),
});
