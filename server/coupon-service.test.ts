import { describe, expect, it } from "vitest";
import { checkCoupon, type CouponDoc } from "./coupon-service";

// عنصر مساعد: كوبون "سليم" بالحد الأدنى من الحقول، تُعدَّل خصائصه في كل اختبار
// بدل تكرار كل الحقول في كل حالة على حدة.
function makeCoupon(overrides: Partial<CouponDoc> = {}): CouponDoc {
  return {
    code: "TEST10",
    discountType: "percentage",
    discountValue: 10,
    isActive: true,
    ...overrides,
  };
}

describe("checkCoupon", () => {
  it("rejects when the coupon does not exist", () => {
    const result = checkCoupon(undefined, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toBe("كود الخصم غير صالح");
  });

  it("rejects an inactive coupon", () => {
    const result = checkCoupon(makeCoupon({ isActive: false }), 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toBe("كود الخصم غير مُفعّل حالياً");
  });

  it("rejects an expired coupon", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const coupon = makeCoupon({
      expiresAt: { toDate: () => yesterday } as unknown as CouponDoc["expiresAt"],
    });
    const result = checkCoupon(coupon, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toBe("انتهت صلاحية كود الخصم");
  });

  it("accepts a coupon that expires in the future", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const coupon = makeCoupon({
      expiresAt: { toDate: () => tomorrow } as unknown as CouponDoc["expiresAt"],
    });
    const result = checkCoupon(coupon, 100);
    expect(result.valid).toBe(true);
  });

  it("rejects when subtotal is below the minimum order amount", () => {
    const result = checkCoupon(makeCoupon({ minOrderAmount: 200 }), 150);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain("200");
  });

  it("accepts when subtotal exactly equals the minimum order amount (inclusive boundary)", () => {
    const result = checkCoupon(makeCoupon({ minOrderAmount: 200 }), 200);
    expect(result.valid).toBe(true);
  });

  it("rejects when the usage limit has been reached", () => {
    const result = checkCoupon(makeCoupon({ usageLimit: 5, usageCount: 5 }), 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toBe("تم استنفاد عدد مرات استخدام هذا الكود");
  });

  it("accepts when usage is below the limit", () => {
    const result = checkCoupon(makeCoupon({ usageLimit: 5, usageCount: 4 }), 100);
    expect(result.valid).toBe(true);
  });

  it("treats usageLimit 0 as unlimited", () => {
    const result = checkCoupon(makeCoupon({ usageLimit: 0, usageCount: 9999 }), 100);
    expect(result.valid).toBe(true);
  });

  it("calculates a percentage discount correctly", () => {
    const result = checkCoupon(makeCoupon({ discountType: "percentage", discountValue: 20 }), 500);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(100);
  });

  it("calculates a fixed discount correctly", () => {
    const result = checkCoupon(makeCoupon({ discountType: "fixed", discountValue: 50 }), 500);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(50);
  });

  it("caps a fixed discount at the subtotal (never a negative order total)", () => {
    const result = checkCoupon(makeCoupon({ discountType: "fixed", discountValue: 500 }), 100);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(100);
  });

  it("does not cap a percentage discount beyond 100% (would need discountValue > 100 to exceed subtotal)", () => {
    const result = checkCoupon(makeCoupon({ discountType: "percentage", discountValue: 100 }), 300);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(300);
  });

  it("rounds the discount amount to 2 decimal places", () => {
    const result = checkCoupon(makeCoupon({ discountType: "percentage", discountValue: 33.333 }), 100);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(33.33);
  });

  it("evaluates minOrderAmount, usageLimit and expiry independently of each other", () => {
    // كوبون يحقق كل الشروط معاً في نفس الوقت — يجب أن ينجح بلا أي تأثير متبادل
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const coupon = makeCoupon({
      minOrderAmount: 100,
      usageLimit: 10,
      usageCount: 3,
      expiresAt: { toDate: () => tomorrow } as unknown as CouponDoc["expiresAt"],
      discountType: "fixed",
      discountValue: 25,
    });
    const result = checkCoupon(coupon, 150);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discountAmount).toBe(25);
  });
});
