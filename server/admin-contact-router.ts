// إدارة رسائل شاشة "اتصل بنا" بالتطبيق — تُكتب مباشرة من عميل الأندرويد
// إلى مجموعة Firestore "contactMessages" (راجع firestore.rules: إنشاء فقط
// من العميل، قراءة/تعديل/حذف عبر لوحة التحكم حصراً بـAdmin SDK هنا).
import { z } from "zod";
import { adminDb } from "./firebase-admin";
import admin from "firebase-admin";
import { router, adminPermission } from "./_core/trpc";

export const adminContactRouter = router({
  // آخر 200 رسالة، الأحدث أولاً.
  list: adminPermission("contactMessages").query(async () => {
    const snapshot = await adminDb
      .collection("contactMessages")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name ?? "",
        email: data.email ?? "",
        subject: data.subject ?? "",
        message: data.message ?? "",
        userId: data.userId ?? null,
        status: data.status ?? "new",
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
      };
    });
  }),

  // تبديل حالة رسالة بين "جديدة" و"تمت معالجتها" — لتتبع أي الرسائل رُد عليها.
  setStatus: adminPermission("contactMessages")
    .input(z.object({ id: z.string(), status: z.enum(["new", "handled"]) }))
    .mutation(async ({ input }) => {
      await adminDb.collection("contactMessages").doc(input.id).set(
        { status: input.status, handledAt: input.status === "handled" ? admin.firestore.Timestamp.now() : null },
        { merge: true }
      );
      return { success: true };
    }),

  delete: adminPermission("contactMessages")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await adminDb.collection("contactMessages").doc(input.id).delete();
      return { success: true };
    }),
});
