// ELEVEN STORE — إجراءات سجل أخطاء النظام (تقرير من أي عميل، قراءة أدمن فقط)
import { z } from "zod";
import { adminDb } from "./firebase-admin";
import { router, publicProcedure, adminProcedure } from "./_core/trpc";
import { checkRateLimit, clientKey } from "./_core/rateLimit";
import { logSystemError, type ErrorLogSource, type ErrorLogSeverity } from "./error-log-service";
import { Timestamp, type Query, type DocumentData } from "firebase-admin/firestore";

const PAGE_SIZE = 30;

export const errorLogRouter = router({
  // ✅ عام عمداً (بلا protectedProcedure): خطأ بتطبيق الأندرويد قد يحدث
  // لمستخدم غير مسجّل دخول، أو خطأ بلوحة التحكم قد يحدث قبل نجاح تسجيل
  // الدخول (مثال: فشل login نفسه). محدود بـ20 تقريراً/دقيقة لكل IP حتى لا
  // يصبح مسار إبلاغ الأخطاء نفسه أداة إغراق (DoS) على قاعدة البيانات.
  reportError: publicProcedure
    .input(
      z.object({
        source: z.enum(["panel", "android"]), // "server" يُسجَّل داخلياً فقط، لا يُقبل من عميل خارجي
        message: z.string().min(1).max(2000),
        stack: z.string().max(8000).optional(),
        route: z.string().max(300).optional(),
        appVersion: z.string().max(50).optional(),
        deviceInfo: z.string().max(200).optional(),
        severity: z.enum(["fatal", "error", "warning"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const key = `reportError:${clientKey(ctx.req)}`;
      if (!checkRateLimit(key, 20, 60 * 1000)) {
        // ✅ فشل صامت عمداً هنا (بلا TRPCError صريح) — هذا مسار إبلاغ أخطاء؛
        // لا نريد أن يفشل هو نفسه بشكل يظهر بواجهة المستخدم كخطأ جديد.
        return { success: false };
      }

      await logSystemError(adminDb, {
        source: input.source as ErrorLogSource,
        message: input.message,
        stack: input.stack,
        route: input.route,
        appVersion: input.appVersion,
        deviceInfo: input.deviceInfo,
        severity: input.severity as ErrorLogSeverity | undefined,
        userId: ctx.user?.id,
        userEmail: ctx.user?.email,
      });

      return { success: true };
    }),

  // أدمن فقط (بلا حاجة لصلاحية تفصيلية — كل الأدمنز يجب أن يروا أعطال
  // النظام التقنية، بخلاف صلاحيات الأقسام التجارية كالكوبونات والرسائل).
  list: adminProcedure
    .input(
      z.object({
        source: z.enum(["panel", "server", "android"]).optional(),
        includeResolved: z.boolean().default(false),
        cursor: z.string().nullish(),
      })
    )
    .query(async ({ input }) => {
      let q: Query<DocumentData> = adminDb
        .collection("systemErrorLogs")
        .orderBy("lastSeenAt", "desc")
        .limit(PAGE_SIZE);

      if (input.source) {
        q = q.where("source", "==", input.source);
      }
      if (!input.includeResolved) {
        q = q.where("resolved", "==", false);
      }
      if (input.cursor) {
        q = q.startAfter(Timestamp.fromDate(new Date(input.cursor)));
      }

      const snapshot = await q.get();
      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          source: data.source as ErrorLogSource,
          message: data.message ?? "",
          stack: data.stack ?? null,
          route: data.route ?? null,
          userId: data.userId ?? null,
          userEmail: data.userEmail ?? null,
          appVersion: data.appVersion ?? null,
          deviceInfo: data.deviceInfo ?? null,
          severity: (data.severity as ErrorLogSeverity) ?? "error",
          count: data.count ?? 1,
          resolved: Boolean(data.resolved),
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
          lastSeenAt: data.lastSeenAt?.toDate ? data.lastSeenAt.toDate().toISOString() : null,
        };
      });

      const last = items[items.length - 1];
      return {
        items,
        nextCursor: items.length === PAGE_SIZE ? last?.lastSeenAt ?? null : null,
      };
    }),

  resolve: adminProcedure
    .input(z.object({ id: z.string(), resolved: z.boolean() }))
    .mutation(async ({ input }) => {
      await adminDb.collection("systemErrorLogs").doc(input.id).set(
        { resolved: input.resolved },
        { merge: true }
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await adminDb.collection("systemErrorLogs").doc(input.id).delete();
      return { success: true };
    }),
});
