// يضمن أن نسخة Cloud Functions (functions/src/lib/orderPricing.ts) تعطي نفس نتائج نسخة السيرفر
// (server/*.ts, shared/deliveryZones.ts) على نفس المدخلات — Cloud Functions لا تستطيع استيراد
// ملفات خارج مجلدها فالمنطق منسوخ، وهذا الاختبار هو ما يمنع انحرافه بصمت عن مسار الموقع.
import { describe, expect, it } from "vitest";
import * as fn from "../../functions/src/lib/orderPricing";
import * as srvPricing from "../../server/pricing-service";
import * as srvCoupon from "../../server/coupon-service";
import * as srvReceipt from "../../server/receipt-url";
import * as srvStock from "../../server/order-stock";
import * as srvZones from "../../shared/deliveryZones";

const future = { toDate: () => new Date(Date.now() + 86_400_000) };
const past = { toDate: () => new Date(Date.now() - 86_400_000) };

describe("تطابق التسعير", () => {
  const settingsCases = [{}, { shippingCost: 50 }, { shippingCost: 20, freeShippingThreshold: 100 }, { freeShippingThreshold: 0 }];
  const subtotals = [0, 50, 99.99, 100, 250.5];

  it("الشحن", () => {
    for (const s of settingsCases) for (const sub of subtotals) {
      expect(fn.calculateShippingCost(sub, s)).toBe(srvPricing.calculateShippingCost(sub, s));
    }
  });

  it("المجموع الفرعي والإجمالي والتقريب", () => {
    const items = [{ price: 19.99, quantity: 3 }, { price: 5, quantity: 1 }];
    expect(fn.calculateSubtotal(items)).toBe(srvPricing.calculateSubtotal(items));
    for (const [sub, disc, ship] of [[100, 10, 30], [0.1 + 0.2, 0, 0], [99.999, 33.333, 30]]) {
      expect(fn.calculateOrderTotal(sub, disc, ship)).toBe(srvPricing.calculateOrderTotal(sub, disc, ship));
    }
  });

  it("دمج أسطر المنتج المكرَّر", () => {
    const lines = [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }, { productId: "a", quantity: 4 }];
    expect(fn.mergeOrderItemQuantities(lines)).toEqual(srvStock.mergeOrderItemQuantities(lines));
  });
});

describe("تطابق الكوبون", () => {
  const base = { code: "X", discountType: "percentage" as const, discountValue: 10, isActive: true };
  const coupons = [
    undefined,
    base,
    { ...base, isActive: false },
    { ...base, discountType: "fixed" as const, discountValue: 500 },
    { ...base, minOrderAmount: 200 },
    { ...base, usageLimit: 5, usageCount: 5 },
    { ...base, usageLimit: 5, usageCount: 4 },
    { ...base, expiresAt: past },
    { ...base, expiresAt: future },
  ];
  it("نفس القرار ونفس مبلغ الخصم لكل الحالات", () => {
    for (const c of coupons) for (const sub of [50, 100, 300]) {
      expect(fn.checkCoupon(c as never, sub)).toEqual(srvCoupon.checkCoupon(c as never, sub));
    }
  });
});

describe("تطابق رابط الإيصال", () => {
  const bucket = "proj.appspot.com";
  const good = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/receipts%2Fu1%2Fr.png?alt=media`;
  const urls = [
    good,
    good.replace("u1", "u2"),
    good.replace("https:", "http:"),
    "https://evil.example/v0/b/x/o/receipts%2Fu1%2Fr.png",
    `https://firebasestorage.googleapis.com/v0/b/other/o/receipts%2Fu1%2Fr.png`,
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/receipts%2Fu1%2F..%2Fu2%2Fr.png`,
    "",
    "not a url",
  ];
  it("نفس القبول/الرفض", () => {
    for (const u of urls) {
      expect(fn.isValidReceiptUrl(u, "u1", bucket)).toBe(srvReceipt.isValidReceiptUrl(u, "u1", bucket));
    }
  });
});

describe("تطابق مناطق التوصيل", () => {
  const square = [
    { lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 },
  ];
  const zones = [
    { id: "1", name: "a", polygon: square, isActive: true },
    { id: "2", name: "b", polygon: [{ lat: 20, lng: 20 }, { lat: 20, lng: 30 }, { lat: 30, lng: 25 }], isActive: false },
  ];
  it("نفس نتيجة النقطة داخل/خارج المنطقة", () => {
    for (const p of [{ lat: 5, lng: 5 }, { lat: 15, lng: 5 }, { lat: 25, lng: 25 }, { lat: -1, lng: -1 }]) {
      expect(fn.isPointInAnyActiveZone(p, zones)).toBe(srvZones.isPointInAnyActiveZone(p, zones));
    }
  });
});
