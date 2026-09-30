import { describe, expect, it } from "vitest";
import { securityHeaders } from "./securityHeaders";

function run(production: boolean, req: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  let nextCalled = false;
  securityHeaders({ production })(req as never, res as never, () => { nextCalled = true; });
  return { headers, nextCalled };
}

describe("securityHeaders", () => {
  it("يضبط الترويسات الأساسية ويكمل السلسلة", () => {
    const { headers, nextCalled } = run(false, { headers: {}, secure: false });
    expect(nextCalled).toBe(true);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("HSTS فقط بالإنتاج وعلى HTTPS (مباشر أو خلف بروكسي)", () => {
    expect(run(true, { headers: { "x-forwarded-proto": "https" }, secure: false }).headers["Strict-Transport-Security"]).toBeDefined();
    expect(run(true, { headers: {}, secure: true }).headers["Strict-Transport-Security"]).toBeDefined();
    expect(run(true, { headers: {}, secure: false }).headers["Strict-Transport-Security"]).toBeUndefined();
    expect(run(false, { headers: { "x-forwarded-proto": "https" }, secure: true }).headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("لا يضبط COOP (يكسر تسجيل الدخول بنافذة Google المنبثقة)", () => {
    expect(run(true, { headers: {}, secure: true }).headers["Cross-Origin-Opener-Policy"]).toBeUndefined();
  });
});
