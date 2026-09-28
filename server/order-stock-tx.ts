// ELEVEN STORE — تطبيق تعديل المخزون داخل معاملة Firestore (يُستخدم من updateOrderStatus
// وupdateOrderReceipt). المنطق القرارّي النقي في order-stock.ts. القواعد المهمة هنا:
//  • كل القراءات قبل أي كتابة (شرط معاملات Firestore) — تُستدعى هذه الدالة *قبل* tx.update للطلب.
//  • تجميع الكميات لكل منتج (منتج مكرَّر بسطرين لا يُحدَّث مرتين من نفس اللقطة القديمة).
//  • "rededuct" يفشل بوضوح (BAD_REQUEST) لو المخزون الحالي لا يكفي، ولا يكتب شيئاً.
import { TRPCError } from "@trpc/server";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { findInsufficientStock, type StockAction } from "./order-stock";

type OrderItem = { productId?: string; quantity?: number; name?: string };

export async function applyStockAction(
  tx: Transaction,
  db: Firestore,
  action: StockAction,
  items: unknown,
): Promise<void> {
  if (action === "none" || !Array.isArray(items) || items.length === 0) return;

  const qtyById = new Map<string, number>();
  const nameById = new Map<string, string>();
  for (const it of items as OrderItem[]) {
    if (!it?.productId) continue;
    qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + (Number(it.quantity) || 0));
    if (it.name) nameById.set(it.productId, it.name);
  }
  const ids = [...qtyById.keys()];
  if (ids.length === 0) return;

  const refs = ids.map((id) => db.collection("products").doc(id));
  const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

  if (action === "rededuct") {
    const stockById: Record<string, number | undefined> = {};
    snaps.forEach((snap: FirebaseFirestore.DocumentSnapshot, i: number) => {
      stockById[ids[i]] = snap.exists ? Number(snap.data()?.stock ?? 0) : undefined;
    });
    const short = findInsufficientStock(
      ids.map((id) => ({ productId: id, quantity: qtyById.get(id), name: nameById.get(id) })),
      stockById,
    );
    if (short.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `لا يمكن إعادة تفعيل الطلب — المخزون غير كافٍ: ${short.join("، ")}`,
      });
    }
  }

  snaps.forEach((snap: FirebaseFirestore.DocumentSnapshot, i: number) => {
    if (!snap.exists) return; // المنتج حُذف لاحقاً — لا شيء نُعدّله (الاستعادة) / سبق رفضه أعلاه (إعادة الخصم)
    const current = Number(snap.data()?.stock ?? 0);
    const qty = qtyById.get(ids[i]) ?? 0;
    tx.update(refs[i], {
      stock: action === "restore" ? current + qty : current - qty,
      updatedAt: new Date(),
    });
  });
}
