import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { AdminPermission } from "@shared/adminPermissions";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// أي أدمن (بصرف النظر عن صلاحياته التفصيلية) — للإجراءات العامة زي إحصائيات
// الداشبورد التي من المعقول أن يراها أي عضو بفريق الإدارة.
export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// أدمن يملك صلاحية قسم محدد تحديداً (السوبر أدمن يملك كل الصلاحيات دائماً).
export function adminPermission(permission: AdminPermission) {
  return t.procedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user || ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }

      const hasPermission =
        ctx.user.isSuperAdmin || (ctx.user.permissions ?? []).includes(permission);

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ليس لديك صلاحية الوصول إلى هذا القسم",
        });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
        },
      });
    }),
  );
}

// إجراءات حسّاسة جداً (إدارة الأدمنز أنفسهم) — صاحب المتجر فقط، بلا استثناء.
export const superAdminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !ctx.user.isSuperAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "هذا الإجراء متاح لصاحب المتجر فقط",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
