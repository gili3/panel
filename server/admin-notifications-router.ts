// إرسال إشعارات من لوحة التحكم — يعيد استخدام notifyUser الموجودة أصلاً
// (نفس المسار المستخدم لإشعارات الترحيب/العروض، مع حماية من التكرار وpush
// حقيقي). هنا فقط طبقة توزيع (لمستخدم واحد أو للجميع) + سجل الحملات المُرسلة.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { adminDb } from "./firebase-admin";
import admin from "firebase-admin";
import { router, adminPermission } from "./_core/trpc";
import { notifyUser } from "./notification-service";
import type { NotificationType } from "@shared/types";

const CHUNK_SIZE = 50; // إرسال على دفعات متوازية محدودة بدل كل المستخدمين مرة واحدة

// ✅ إصلاح (خطر Timeout عند البث لعدد كبير من المستخدمين): كانت "send"
// تنتظر إرسال كل المستخدمين قبل الرد — لمتجر بآلاف المستخدمين هذا قد يتجاوز
// مهلة الطلب. السيرفر عملية Node.js دائمة التشغيل (وليس Cloud Function
// بحد زمني صارم لكل طلب) — لذا نرد فوراً بعدد المستهدفين، ونكمل الإرسال
// الفعلي بالخلفية (fire-and-forget)، ثم نُحدّث سجل الحملة بالعدد الفعلي
// المُرسَل بعد الانتهاء (أو بأي فشل حدث أثناء الإرسال).
async function broadcastToAllUsersInBackground(
  campaignId: string,
  input: { title: string; body: string; actionRoute?: string; imageUrl?: string; type: NotificationType }
) {
  let sentCount = 0;
  let failedCount = 0;
  try {
    const usersSnapshot = await adminDb.collection("users").select().get();
    const uids = usersSnapshot.docs.map(d => d.id);
    for (let i = 0; i < uids.length; i += CHUNK_SIZE) {
      const chunk = uids.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(uid =>
          notifyUser({
            userId: uid,
            dedupeKey: `admin-notify:${campaignId}:${uid}`,
            title: input.title,
            body: input.body,
            type: input.type,
            actionRoute: input.actionRoute,
            imageUrl: input.imageUrl,
          })
        )
      );
      sentCount += results.filter(r => r.status === "fulfilled").length;
      failedCount += results.filter(r => r.status === "rejected").length;
    }
  } catch (error) {
    console.error(`[adminNotifications] فشل بث الحملة ${campaignId}:`, error);
  } finally {
    await adminDb.collection("notificationCampaigns").doc(campaignId).set(
      { sentCount, failedCount, status: "done" },
      { merge: true }
    );
  }
}

export const adminNotificationsRouter = router({
  // إرسال لمستخدم واحد أو بث للجميع، وتسجيل الحملة لعرضها بالسجل لاحقاً.
  send: adminPermission("notifications")
    .input(z.object({
      title: z.string().min(1).max(120),
      body: z.string().min(1).max(500),
      target: z.enum(["all", "user"]),
      userId: z.string().optional(),
      actionRoute: z.string().optional(),
      // ✅ جديد: صورة اختيارية (بالأخص إشعارات العروض) + نوع الإشعار — كان
      // "type" مثبَّتاً دائماً على "general" بلا أي طريقة لاختيار "promo"
      // رغم أن NotificationType تدعمها أصلاً بالسيرفر والعميل والأندرويد.
      imageUrl: z.string().url().optional(),
      type: z.enum(["order", "shipping", "promo", "welcome", "general"]).default("general"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.target === "user" && !input.userId) {
        throw new Error("يجب تحديد المستخدم عند اختيار إرسال لمستخدم واحد");
      }

      const campaignId = randomUUID();

      if (input.target === "user") {
        await notifyUser({
          userId: input.userId!,
          dedupeKey: `admin-notify:${campaignId}:${input.userId}`,
          title: input.title,
          body: input.body,
          type: input.type,
          actionRoute: input.actionRoute,
          imageUrl: input.imageUrl,
        });

        await adminDb.collection("notificationCampaigns").doc(campaignId).set({
          title: input.title,
          body: input.body,
          target: input.target,
          userId: input.userId ?? null,
          imageUrl: input.imageUrl ?? null,
          type: input.type,
          sentCount: 1,
          failedCount: 0,
          status: "done",
          createdAt: admin.firestore.Timestamp.now(),
          createdBy: ctx.user.email ?? ctx.user.id,
        });

        return { success: true, sentCount: 1 };
      }

      // بث للجميع: نسجّل الحملة فوراً بحالة "قيد الإرسال" ونرد على الأدمن
      // بدون انتظار اكتمال الإرسال الفعلي لكل مستخدم.
      const totalUsersSnapshot = await adminDb.collection("users").count().get();
      const estimatedCount = totalUsersSnapshot.data().count;

      await adminDb.collection("notificationCampaigns").doc(campaignId).set({
        title: input.title,
        body: input.body,
        target: input.target,
        userId: null,
        imageUrl: input.imageUrl ?? null,
        type: input.type,
        sentCount: 0,
        failedCount: 0,
        estimatedCount,
        status: "sending",
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: ctx.user.email ?? ctx.user.id,
      });

      // لا await هنا عمداً — الإرسال يكمل بالخلفية بعد الرد على الأدمن.
      void broadcastToAllUsersInBackground(campaignId, {
        title: input.title,
        body: input.body,
        actionRoute: input.actionRoute,
        imageUrl: input.imageUrl,
        type: input.type,
      });

      return { success: true, sentCount: estimatedCount };
    }),

  // آخر 30 حملة إشعارات مُرسلة من اللوحة.
  getHistory: adminPermission("notifications").query(async () => {
    const snapshot = await adminDb
      .collection("notificationCampaigns")
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        body: data.body,
        target: data.target,
        userId: data.userId ?? null,
        imageUrl: data.imageUrl ?? null,
        type: data.type ?? "general",
        sentCount: data.sentCount ?? 0,
        estimatedCount: data.estimatedCount ?? null,
        status: data.status ?? "done",
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
        createdBy: data.createdBy ?? null,
      };
    });
  }),
});
