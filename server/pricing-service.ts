// ELEVEN STORE — منطق التسعير/الشحن (دوال نقية بلا أي اتصال بـFirestore)
// ─────────────────────────────────────────────────────────────────────────
// ✅ إصلاح (مراجعة الاختبارات): كان حساب الشحن والإجمالي مدموجاً بالكامل
// داخل runOrderPricingTransaction بـfirestore-router.ts، ضمن Transaction
// حقيقية (adminDb.runTransaction) — ما يجعل كتابة اختبار له يتطلب تشغيل/محاكاة
// Firestore بالكامل بدل اختبار المنطق الحسابي نفسه بشكل معزول. هذا الملف
// يستخرج نفس القواعد الحسابية بالضبط كدوال نقية (input -> output فقط، بلا أي
// side effect)، تُستخدم الآن من runOrderPricingTransaction، ويسهل اختباراتها
// مباشرة في pricing-service.test.ts.

/** الحقول الوحيدة من settings/store التي يحتاجها حساب الشحن. */
export type StoreShippingSettings = {
  shippingCost?: number;
  freeShippingThreshold?: number;
};

/** الحد الافتراضي لتكلفة الشحن إن لم يوجد إعداد مخزَّن (مطابق للقيمة الأصلية بالكود). */
export const DEFAULT_SHIPPING_COST = 30;

/**
 * تكلفة الشحن الفعلية لطلب بمجموع فرعي `subtotal`:
 * - إن كان هناك حد أدنى للشحن المجاني (`freeShippingThreshold > 0`) وتم بلوغه
 *   أو تجاوزه (`subtotal >= freeShippingThreshold`) → الشحن مجاني (0).
 * - غير ذلك → قيمة `shippingCost` المخزَّنة، أو `DEFAULT_SHIPPING_COST` إن لم تُضبط.
 */
export function calculateShippingCost(subtotal: number, settings: StoreShippingSettings): number {
  const shippingBase = Number(settings.shippingCost ?? DEFAULT_SHIPPING_COST);
  const freeShippingThreshold = Number(settings.freeShippingThreshold ?? 0);
  const qualifiesForFreeShipping = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold;
  return qualifiesForFreeShipping ? 0 : shippingBase;
}

export type PricedLineItem = { price: number; quantity: number };

/** المجموع الفرعي = سعر كل عنصر (المُشتق من المنتج نفسه، لا من العميل) × كميته. */
export function calculateSubtotal(items: PricedLineItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/** تقريب أي قيمة نقدية لأقرب منزلتين عشريتين (يمنع أخطاء الفاصلة العائمة الدقيقة). */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** الإجمالي النهائي: المجموع الفرعي ناقص الخصم زائد الشحن، مقرَّباً. */
export function calculateOrderTotal(subtotal: number, discountAmount: number, shippingCost: number): number {
  return roundCurrency(subtotal - discountAmount + shippingCost);
}
