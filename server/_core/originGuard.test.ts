import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "./originGuard";

const allowed = ["https://eleven-x9ed.onrender.com", "capacitor://localhost"];

describe("isOriginAllowed (حماية CSRF)", () => {
  it("بلا Origin (تطبيق أصلي/curl) → مسموح", () => {
    expect(isOriginAllowed(undefined, allowed, ["api.example.com"])).toBe(true);
  });
  it("Origin من القائمة البيضاء → مسموح", () => {
    expect(isOriginAllowed("https://eleven-x9ed.onrender.com", allowed, ["x"])).toBe(true);
    expect(isOriginAllowed("capacitor://localhost", allowed, ["x"])).toBe(true);
  });
  it("نفس مضيف الخادم (اللوحة على نطاقها الخاص) → مسموح", () => {
    expect(isOriginAllowed("https://panel.eleven.sd", allowed, ["panel.eleven.sd"])).toBe(true);
    expect(isOriginAllowed("https://panel.eleven.sd", allowed, [undefined, "PANEL.eleven.sd"])).toBe(true);
  });
  it("موقع خارجي أو subdomain مشابه → مرفوض", () => {
    expect(isOriginAllowed("https://evil.example", allowed, ["panel.eleven.sd"])).toBe(false);
    expect(isOriginAllowed("https://eleven-x9ed.onrender.com.evil.example", allowed, ["panel.eleven.sd"])).toBe(false);
    expect(isOriginAllowed("https://other.onrender.com", allowed, ["panel.eleven.sd"])).toBe(false);
  });
  it("Origin غير صالح أو 'null' (iframe sandbox) → مرفوض", () => {
    expect(isOriginAllowed("null", allowed, ["panel.eleven.sd"])).toBe(false);
    expect(isOriginAllowed("not a url", allowed, ["panel.eleven.sd"])).toBe(false);
  });
});
