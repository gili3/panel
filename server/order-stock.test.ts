import { describe, expect, it } from "vitest";
import { findInsufficientStock, mergeOrderItemQuantities, planStockAction } from "./order-stock";

describe("planStockAction — مزامنة المخزون مع الحالة", () => {
  it("الانتقال إلى إلغاء/فشل دفع لأول مرة → restore", () => {
    expect(planStockAction("under_review", "cancelled", false)).toBe("restore");
    expect(planStockAction("processing", "payment_failed", false)).toBe("restore");
  });
  it("لا إرجاع مضاعف إذا سبق الإرجاع (stockRestored) أو كان بحالة مرجِعة أصلاً", () => {
    expect(planStockAction("under_review", "cancelled", true)).toBe("none");
    expect(planStockAction("cancelled", "payment_failed", true)).toBe("none");
    expect(planStockAction("cancelled", "cancelled", true)).toBe("none");
  });
  it("الخروج من إلغاء/فشل دفع إلى حالة نشطة بعد إرجاع المخزون → rededuct", () => {
    expect(planStockAction("cancelled", "under_review", true)).toBe("rededuct");
    expect(planStockAction("payment_failed", "processing", true)).toBe("rededuct");
  });
  it("طلب قديم ملغى بلا علامة stockRestored لا يُخصم منه شيء عند إعادة التفعيل", () => {
    expect(planStockAction("cancelled", "under_review", false)).toBe("none");
  });
  it("انتقالات بين حالات نشطة لا تلمس المخزون", () => {
    expect(planStockAction("under_review", "processing", false)).toBe("none");
    expect(planStockAction("processing", "out_for_delivery", false)).toBe("none");
    expect(planStockAction("out_for_delivery", "delivered", false)).toBe("none");
  });
  it("حالة سابقة غير معرّفة لا تنهار", () => {
    expect(planStockAction(undefined, "cancelled", false)).toBe("restore");
    expect(planStockAction(undefined, "processing", false)).toBe("none");
  });
});

describe("findInsufficientStock", () => {
  const items = [
    { productId: "a", quantity: 2, name: "منتج أ" },
    { productId: "b", quantity: 1, name: "منتج ب" },
  ];
  it("يعيد قائمة فارغة عند كفاية المخزون", () => {
    expect(findInsufficientStock(items, { a: 2, b: 5 })).toEqual([]);
  });
  it("يعيد أسماء المنتجات ناقصة المخزون (وحذف المنتج = غير كافٍ)", () => {
    expect(findInsufficientStock(items, { a: 1, b: undefined })).toEqual(["منتج أ", "منتج ب"]);
  });
});

describe("mergeOrderItemQuantities", () => {
  it("يجمع كميات نفس المنتج المكرَّر بسطرين أو أكثر في سطر واحد", () => {
    expect(mergeOrderItemQuantities([
      { productId: "p1", quantity: 1 },
      { productId: "p1", quantity: 1 },
      { productId: "p2", quantity: 3 },
    ])).toEqual([{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 3 }]);
  });
  it("لا يغيّر ترتيب أو قيم الأسطر غير المكرَّرة", () => {
    expect(mergeOrderItemQuantities([{ productId: "a", quantity: 5 }])).toEqual([{ productId: "a", quantity: 5 }]);
  });
  it("قائمة فارغة تُعيد قائمة فارغة", () => {
    expect(mergeOrderItemQuantities([])).toEqual([]);
  });
});
