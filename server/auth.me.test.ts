import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// يحل محل auth.logout.test.ts القديم: كان يستدعي إجراء tRPC `auth.logout` غير الموجود أصلاً
// (تسجيل الخروج الحقيقي عبر POST /api/session/logout ومغطّى بـsession.logout.test.ts).
// الإجراء الفعلي الوحيد بـauth router هو `me` — يُختبر هنا.

const req = { protocol: "https", headers: {} } as TrpcContext["req"];
const res = {} as TrpcContext["res"];

describe("auth.me", () => {
  it("يُرجع null بدون مستخدم مسجَّل", async () => {
    const caller = appRouter.createCaller({ user: null, req, res } as TrpcContext);
    expect(await caller.auth.me()).toBeNull();
  });

  it("يُرجع الحقول العامة فقط، ويجعل isSuperAdmin=false وpermissions=[] افتراضياً", async () => {
    const user = {
      id: 1,
      openId: "sample-user",
      email: "sample@example.com",
      name: "Sample User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>;
    const caller = appRouter.createCaller({ user, req, res } as TrpcContext);

    expect(await caller.auth.me()).toEqual({
      id: 1,
      openId: "sample-user",
      email: "sample@example.com",
      name: "Sample User",
      role: "user",
      isSuperAdmin: false,
      permissions: [],
    });
  });
});
