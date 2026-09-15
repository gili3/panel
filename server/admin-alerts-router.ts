// جرس تنبيهات لوحة التحكم — منفصل تماماً عن adminNotifications (بث Push
// للعملاء) وعن firestore.notifications (قائمة إشعارات العميل النهائي).
// يقرأ من مجموعة adminAlerts التي تُنشئها Cloud Functions (orderTriggers,
// contactMessageTriggers) — راجع functions/src/lib/adminAlerts.ts للشرح
// المعماري الكامل.
import { z } from "zod";
import admin from "firebase-admin";
import { adminDb } from "./firebase-admin";
import { adminProcedure, router } from "./_core/trpc";
import type { AdminPermission } from "@shared/adminPermissions";

// آخر N تنبيه فقط تُفحص — الجرس واجهة "آخر الأحداث"، ليس أرشيفاً كاملاً.
// كافٍ جداً عملياً (حتى بمعدل عشرات الطلبات/الرسائل يومياً) ويبقي كل قراءة
// خفيفة بلا فهرسة إضافية على readBy (Firestore لا يدعم استعلام مصفوفات كهذا).
const RECENT_LIMIT = 30;

type AdminAlertDoc = {
  id: string;
  type: string;
  requiredPermission: AdminPermission;
  title: string;
  body: string;
  actionRoute: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string | null;
  readBy: string[];
};

async function fetchVisibleAlerts(
  isSuperAdmin: boolean,
  permissions: AdminPermission[]
): Promise<AdminAlertDoc[]> {
  const snapshot = await adminDb
    .collection("adminAlerts")
    .orderBy("createdAt", "desc")
    .limit(RECENT_LIMIT)
    .get();

  return snapshot.docs
    .map((doc): AdminAlertDoc => {
      const data = doc.data();
      return {
        id: doc.id,
        type: data.type ?? "",
        requiredPermission: data.requiredPermission,
        title: data.title ?? "",
        body: data.body ?? "",
        actionRoute: data.actionRoute ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
        readBy: Array.isArray(data.readBy) ? data.readBy : [],
      };
    })
    // فلترة الرؤية حسب صلاحيات هذا الأدمن تحديداً وقت الطلب — وليس وقت
    // الإنشاء — فأي أدمن يُمنح صلاحية لاحقاً يرى فوراً كل ما فات مطابقاً لها.
    .filter((alert) => isSuperAdmin || permissions.includes(alert.requiredPermission));
}

export const adminAlertsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const isSuperAdmin = Boolean(ctx.user.isSuperAdmin);
    const permissions = (ctx.user.permissions ?? []) as AdminPermission[];
    const alerts = await fetchVisibleAlerts(isSuperAdmin, permissions);
    const uid = ctx.user.openId;

    const items = alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      title: alert.title,
      body: alert.body,
      actionRoute: alert.actionRoute,
      entityType: alert.entityType,
      entityId: alert.entityId,
      createdAt: alert.createdAt,
      isRead: alert.readBy.includes(uid),
    }));

    return {
      items,
      unreadCount: items.filter((item) => !item.isRead).length,
    };
  }),

  markRead: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.user.openId;
      const batch = adminDb.batch();
      for (const id of input.ids) {
        batch.set(
          adminDb.collection("adminAlerts").doc(id),
          { readBy: admin.firestore.FieldValue.arrayUnion(uid) },
          { merge: true }
        );
      }
      await batch.commit();
      return { success: true };
    }),

  markAllRead: adminProcedure.mutation(async ({ ctx }) => {
    const isSuperAdmin = Boolean(ctx.user.isSuperAdmin);
    const permissions = (ctx.user.permissions ?? []) as AdminPermission[];
    const uid = ctx.user.openId;
    const alerts = await fetchVisibleAlerts(isSuperAdmin, permissions);
    const unread = alerts.filter((alert) => !alert.readBy.includes(uid));

    if (unread.length > 0) {
      const batch = adminDb.batch();
      for (const alert of unread) {
        batch.set(
          adminDb.collection("adminAlerts").doc(alert.id),
          { readBy: admin.firestore.FieldValue.arrayUnion(uid) },
          { merge: true }
        );
      }
      await batch.commit();
    }
    return { success: true };
  }),
});
