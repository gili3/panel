// ELEVEN STORE — منطق موحّد لمزامنة المخزون مع حالة الطلب (مصدر واحد)
// ─────────────────────────────────────────────────────────────────────────
// الحالتان "cancelled" و"payment_failed" تعنيان أن الطلب لن يُنفَّذ، فيُعاد مخزونه
// (وتُوضَع علامة stockRestored على الطلب). الفجوة التي أُغلقت هنا: الانتقال *من*
// إحدى هاتين الحالتين إلى حالة نشطة (إعادة تفعيل طلب ملغى، أو إعادة رفع إيصال بعد
// فشل الدفع) كان يترك المخزون "المُرجَع" كما هو بلا خصم جديد — فيظهر مخزون أعلى
// من الحقيقي ويمكن بيع نفس الوحدات مرتين. الآن نعيد خصمه (ونفشل بوضوح إن لم يكفِ).
export const STOCK_RESTORING_STATUSES: ReadonlySet<string> = new Set(["cancelled", "payment_failed"]);

export type StockAction = "restore" | "rededuct" | "none";

export function planStockAction(
  previousStatus: string | undefined,
  nextStatus: string,
  stockRestored: boolean,
): StockAction {
  const was = STOCK_RESTORING_STATUSES.has(previousStatus ?? "");
  const will = STOCK_RESTORING_STATUSES.has(nextStatus);
  if (will && !was && !stockRestored) return "restore";
  if (!will && was && stockRestored) return "rededuct";
  return "none";
}

/** أسماء المنتجات التي لا يكفي مخزونها الحالي لإعادة الخصم (فارغ = كل شيء متوفر). */
export function findInsufficientStock(
  items: Array<{ productId: string; quantity?: number; name?: string }>,
  currentStockById: Record<string, number | undefined>,
): string[] {
  return items
    .filter((it) => (currentStockById[it.productId] ?? 0) < (it.quantity || 0))
    .map((it) => it.name || it.productId);
}

/** يدمج أسطر الطلب المكرَّرة لنفس المنتج بجمع كمياتها في سطر واحد — يمنع
 * تكرار نفس المنتج بسطرين من التحايل على فحص المخزون (كل سطر يُفحَص مقابل
 * نفس الرصيد الأصلي) وعلى خصم المخزون (آخر كتابة لنفس المستند بمعاملة واحدة
 * تُلغي ما قبلها). راجع الاستخدام بـrunOrderPricingTransaction (firestore-router.ts).
 */
export function mergeOrderItemQuantities<T extends { productId: string; quantity: number }>(
  items: readonly T[],
): Array<{ productId: string; quantity: number }> {
  const qtyById = new Map<string, number>();
  for (const it of items) {
    qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.quantity);
  }
  return [...qtyById].map(([productId, quantity]) => ({ productId, quantity }));
}
