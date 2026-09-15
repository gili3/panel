// إدارة رسائل شاشة "اتصل بنا" بالتطبيق — تُكتب مباشرة من عميل الأندرويد
// إلى مجموعة Firestore "contactMessages" (راجع firestore.rules: إنشاء فقط
// من العميل، قراءة/تعديل/حذف عبر لوحة التحكم حصراً بـAdmin SDK هنا).
import { z } from "zod";
import { adminDb } from "./firebase-admin";
import admin from "firebase-admin";
import { router, adminPermission } from "./_core/trpc";
import { notifyUser } from "./notification-service";

const PAGE_SIZE = 30;

export const adminContactRouter = router({
  // ✅ إصلاح: كانت "list" تجلب آخر 200 رسالة بحد أقصى صريح بلا أي تصفّح —
  // أي رسالة أقدم من ذلك تختفي نهائياً من اللوحة رغم بقائها بـFirestore.
  // الآن صفحات فعلية بمؤشر (cursor بمعنى createdAt لآخر عنصر بالصفحة
  // السابقة)، فالتاريخ الكامل يبقى متاحاً بالتمرير للمزيد.
  list: adminPermission("contactMessages")
    .input(
      z.object({
        cursor: z.string().nullish(), // ISO timestamp لآخر رسالة من الصفحة السابقة
      })
    )
    .query(async ({ input }) => {
      let q = adminDb
        .collection("contactMessages")
        .orderBy("createdAt", "desc")
        .limit(PAGE_SIZE);

      if (input.cursor) {
        q = q.startAfter(admin.firestore.Timestamp.fromDate(new Date(input.cursor)));
      }

      const snapshot = await q.get();
      const items = snapshot.docs.map((doc) => {
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
          reply: data.reply ?? null,
          repliedAt: data.repliedAt?.toDate ? data.repliedAt.toDate().toISOString() : null,
          // ✅ جديد: حجز الرسالة لأدمن معيّن — يمنع ردّ اثنين على نفس الرسالة
          // بنفس الوقت دون أن يعرف أحدهما عن الآخر. راجع claim/unclaim تحت.
          claimedBy: data.claimedBy ?? null,
          claimedByName: data.claimedByName ?? null,
        };
      });

      const last = items[items.length - 1];
      return {
        items,
        // مفيش رسائل بالصفحة == آخر صفحة فعلاً؛ أقل من PAGE_SIZE أيضاً كافية كإشارة توقف.
        nextCursor: items.length === PAGE_SIZE ? last?.createdAt ?? null : null,
      };
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

  // ✅ جديد: رد داخل التطبيق (بديل/إضافة لـmailto السابق الذي لا يعمل إن
  // كتب الزائر إيميلاً خاطئاً أو تركه فارغاً). يتطلب userId على الرسالة —
  // أي أن كاتبها كان مسجّل دخول وقتها؛ رسائل الزوّار غير المسجّلين تبقى
  // تُرَدّ عليها بالبريد فقط.
  reply: adminPermission("contactMessages")
    .input(z.object({ id: z.string(), message: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const ref = adminDb.collection("contactMessages").doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new Error("الرسالة غير موجودة");
      }
      const data = snap.data()!;
      const userId: string | null = data.userId ?? null;

      await ref.set(
        {
          reply: input.message,
          repliedAt: admin.firestore.Timestamp.now(),
          status: "handled",
          handledAt: admin.firestore.Timestamp.now(),
        },
        { merge: true }
      );

      if (userId) {
        await notifyUser({
          userId,
          dedupeKey: `contact_reply:${input.id}:${Date.now()}`,
          type: "general",
          title: "رد على رسالتك",
          body: input.message,
          actionRoute: "/contact-messages",
        });
      }

      return { success: true, delivered: Boolean(userId) };
    }),

  // ✅ جديد: حجز رسالة لأدمن معيّن قبل الرد عليها. عندما يكون هناك أكثر من
  // أدمن بصلاحية "contactMessages"، كان ممكن اتنين يفتحوا ويردّوا على نفس
  // الرسالة في نفس اللحظة بلا أي علم أحدهما بالآخر. Transaction هنا (وليس
  // set/merge مباشر) حتى لا يحصل سباق فعلي بين حجزين بنفس اللحظة تماماً —
  // لو الرسالة محجوزة بالفعل من أدمن آخر، تُرفض بخطأ واضح؛ لو محجوزة من
  // نفس الأدمن أصلاً، العملية idempotent وتنجح بلا أثر إضافي.
  claim: adminPermission("contactMessages")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = adminDb.collection("contactMessages").doc(input.id);
      const uid = ctx.user.openId;
      const name = ctx.user.name || ctx.user.email || "أدمن";

      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          throw new Error("الرسالة غير موجودة");
        }
        const data = snap.data()!;
        if (data.claimedBy && data.claimedBy !== uid) {
          throw new Error(`الرسالة محجوزة بالفعل من ${data.claimedByName || "أدمن آخر"}`);
        }
        tx.set(
          ref,
          { claimedBy: uid, claimedByName: name, claimedAt: admin.firestore.Timestamp.now() },
          { merge: true }
        );
      });

      return { success: true };
    }),

  // إلغاء الحجز — أي أدمن بصلاحية contactMessages يقدر يفكّه (مثلاً لو
  // الأدمن الأصلي غاب/سافر)، وليس فقط صاحب الحجز نفسه، تفادياً لرسالة
  // "معلّقة" للأبد لو صاحب الحجز لم يعد متاحاً.
  unclaim: adminPermission("contactMessages")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await adminDb.collection("contactMessages").doc(input.id).set(
        { claimedBy: null, claimedByName: null, claimedAt: null },
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
