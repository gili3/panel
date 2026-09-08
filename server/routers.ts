import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { firestoreRouter } from "./firestore-router";
import { adminUsersRouter } from "./admin-users-router";
import { adminNotificationsRouter } from "./admin-notifications-router";

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
});

export type AppRouter = typeof appRouter;
