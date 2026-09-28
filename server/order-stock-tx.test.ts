import { describe, expect, it } from "vitest";
import { applyStockAction } from "./order-stock-tx";

// معاملة وهمية بسيطة: get يقرأ من خريطة، update يسجّل الكتابات
function fakeEnv(products: Record<string, { stock: number } | null>) {
  const writes: Array<{ id: string; data: any }> = [];
  const db: any = {
    collection: (_: string) => ({ doc: (id: string) => ({ id }) }),
  };
  const tx: any = {
    get: async (ref: { id: string }) => {
      const p = products[ref.id];
      return { exists: p != null, data: () => p ?? undefined };
    },
    update: (ref: { id: string }, data: any) => writes.push({ id: ref.id, data }),
  };
  return { db, tx, writes };
}

describe("applyStockAction", () => {
  it("restore: يُضيف الكمية لكل منتج، ويجمع الأسطر المكرّرة لنفس المنتج", async () => {
    const { db, tx, writes } = fakeEnv({ p1: { stock: 5 }, p2: { stock: 0 } });
    await applyStockAction(tx, db, "restore", [
      { productId: "p1", quantity: 2 },
      { productId: "p1", quantity: 3 },
      { productId: "p2", quantity: 1 },
    ]);
    expect(writes.map((w) => [w.id, w.data.stock])).toEqual([["p1", 10], ["p2", 1]]);
  });

  it("rededuct: يخصم عند كفاية المخزون", async () => {
    const { db, tx, writes } = fakeEnv({ p1: { stock: 5 } });
    await applyStockAction(tx, db, "rededuct", [{ productId: "p1", quantity: 2 }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].data.stock).toBe(3);
  });

  it("rededuct: يفشل بلا أي كتابة إن لم يكفِ المخزون أو حُذف المنتج", async () => {
    const { db, tx, writes } = fakeEnv({ p1: { stock: 1 }, p2: null });
    await expect(
      applyStockAction(tx, db, "rededuct", [
        { productId: "p1", quantity: 2, name: "أ" },
        { productId: "p2", quantity: 1, name: "ب" },
      ]),
    ).rejects.toThrow(/المخزون غير كافٍ/);
    expect(writes).toHaveLength(0);
  });

  it("restore: منتج محذوف يُتجاهل بدل الفشل", async () => {
    const { db, tx, writes } = fakeEnv({ p1: null });
    await applyStockAction(tx, db, "restore", [{ productId: "p1", quantity: 2 }]);
    expect(writes).toHaveLength(0);
  });

  it("none / عناصر غير صالحة: لا قراءة ولا كتابة", async () => {
    const { db, tx, writes } = fakeEnv({});
    await applyStockAction(tx, db, "none", [{ productId: "p1", quantity: 1 }]);
    await applyStockAction(tx, db, "restore", undefined);
    await applyStockAction(tx, db, "restore", []);
    expect(writes).toHaveLength(0);
  });
});
