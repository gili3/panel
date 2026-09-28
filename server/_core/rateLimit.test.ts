import { describe, expect, it } from "vitest";
import { pickClientIp } from "./rateLimit";

describe("pickClientIp", () => {
  it("بدون hops: السلوك القديم (أول عنوان) محفوظ", () => {
    expect(pickClientIp("1.1.1.1, 2.2.2.2", "9.9.9.9", 0)).toBe("1.1.1.1");
    expect(pickClientIp(undefined, "9.9.9.9", 0)).toBe("9.9.9.9");
    expect(pickClientIp(undefined, undefined, 0)).toBe("unknown");
  });
  it("مع hops=1: عنوان أقرب بروكسي موثوق من النهاية، فتزييف البداية لا يغيّر المفتاح", () => {
    const real = "203.0.113.7";
    expect(pickClientIp(`6.6.6.6, ${real}`, "10.0.0.1", 1)).toBe(real);
    expect(pickClientIp(`7.7.7.7, ${real}`, "10.0.0.1", 1)).toBe(real);
  });
  it("مع hops=2 (Cloudflare + موزّع): العنصر قبل الأخير", () => {
    expect(pickClientIp("6.6.6.6, 203.0.113.7, 172.70.0.1", "10.0.0.1", 2)).toBe("203.0.113.7");
  });
  it("hops أكبر من طول القائمة لا ينهار", () => {
    expect(pickClientIp("203.0.113.7", "10.0.0.1", 3)).toBe("203.0.113.7");
  });
});
