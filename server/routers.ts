import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { firestoreRouter } from "./firestore-router";
import { adminUsersRouter } from "./admin-users-router";
import { adminNotificationsRouter } from "./admin-notifications-router";
import { adminContactRouter } from "./admin-contact-router";
import { errorLogRouter } from "./error-log-router";
import { deliveryZoneRouter } from "./delivery-zone-router";
// ✅ v2: adminAlertsRouter (list/markRead/markAllRead عبر tRPC + polling)
// أُزيل بالكامل — الجرس الآن onSnapshot حي مباشرة على
// users/{uid}/adminAlerts (راجع client/src/hooks/useAdminAlerts.ts)،
// وmarkRead/markAllRead كتابات Firestore مباشرة يسمح بها firestore.rules
// (isOwner + onlyChangedKeys(['isRead','readAt'])) بلا أي حاجة لخادم وسيط.
// ملف server/admin-alerts-router.ts نفسه يُحذف من المشروع.

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) {
        return null;
      }
      return {
        id: opts.ctx.user.id,
        openId: opts.ctx.user.openId,
        email: opts.ctx.user.email,
        name: opts.ctx.user.name,
        role: opts.ctx.user.role,
        isSuperAdmin: Boolean(opts.ctx.user.isSuperAdmin),
        permissions: opts.ctx.user.permissions ?? [],
      };
    }),
  }),
  firestore: firestoreRouter,
  adminUsers: adminUsersRouter,
  adminNotifications: adminNotificationsRouter,
  adminContact: adminContactRouter,
  errorLog: errorLogRouter,
  deliveryZones: deliveryZoneRouter,
});

export type AppRouter = typeof appRouter;
