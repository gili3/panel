/**
 * منطق التسعير/الكوبون/منطقة التوصيل/رابط الإيصال لمسار إنشاء الطلب عبر Cloud Function.
 *
 * ⚠️ نسخة مطابقة عمداً لملفات السيرفر (Cloud Functions لا تستطيع استيراد ملفات خارج
 * مجلدها لأن rootDir = src):
 *   server/pricing-service.ts · server/coupon-service.ts · server/receipt-url.ts
 *   server/order-stock.ts (mergeOrderItemQuantities) · shared/deliveryZones.ts
 * أي تعديل هنا يجب أن يُطبَّق هناك أيضاً — يحرس ذلك الاختبار
 * tests/functions/order-pricing-parity.test.ts (يقارن النسختين على نفس المدخلات).
 */

// ─── مناطق التوصيل ───────────────────────────────────────────────────────
export type LatLng = { lat: number; lng: number };
export type DeliveryZone = { id: string; name: string; polygon: LatLng[]; isActive: boolean };

export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isPointInAnyActiveZone(point: LatLng, zones: DeliveryZone[]): boolean {
  return zones.some((z) => z.isActive && isPointInPolygon(point, z.polygon));
}

// ─── التسعير ─────────────────────────────────────────────────────────────
export type StoreShippingSettings = { shippingCost?: number; freeShippingThreshold?: number };
export const DEFAULT_SHIPPING_COST = 30;

export function calculateShippingCost(subtotal: number, settings: StoreShippingSettings): number {
  const shippingBase = Number(settings.shippingCost ?? DEFAULT_SHIPPING_COST);
  const freeShippingThreshold = Number(settings.freeShippingThreshold ?? 0);
  const qualifiesForFreeShipping = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold;
  return qualifiesForFreeShipping ? 0 : shippingBase;
}

export type PricedLineItem = { price: number; quantity: number };

export function calculateSubtotal(items: PricedLineItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function calculateOrderTotal(subtotal: number, discountAmount: number, shippingCost: number): number {
  return roundCurrency(subtotal - discountAmount + shippingCost);
}

export function mergeOrderItemQuantities<T extends { productId: string; quantity: number }>(
  items: readonly T[],
): Array<{ productId: string; quantity: number }> {
  const qtyById = new Map<string, number>();
  for (const it of items) {
    qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.quantity);
  }
  return [...qtyById].map(([productId, quantity]) => ({ productId, quantity }));
}

// ─── الكوبون ─────────────────────────────────────────────────────────────
export type CouponDoc = {
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  isActive: boolean;
  minOrderAmount?: number;
  usageLimit?: number;
  usageCount?: number;
  expiresAt?: { toDate?: () => Date } | null;
};

export type CouponCheckResult =
  | { valid: true; discountAmount: number; coupon: CouponDoc }
  | { valid: false; message: string };

export function checkCoupon(coupon: CouponDoc | undefined, subtotal: number): CouponCheckResult {
  if (!coupon) return { valid: false, message: "كود الخصم غير صالح" };
  if (!coupon.isActive) return { valid: false, message: "كود الخصم غير مُفعّل حالياً" };

  if (coupon.expiresAt) {
    const expiry = coupon.expiresAt.toDate ? coupon.expiresAt.toDate() : new Date(coupon.expiresAt as unknown as string);
    if (expiry.getTime() < Date.now()) {
      return { valid: false, message: "انتهت صلاحية كود الخصم" };
    }
  }

  const minOrder = coupon.minOrderAmount ?? 0;
  if (subtotal < minOrder) {
    return { valid: false, message: `الحد الأدنى للطلب لاستخدام هذا الكود ${minOrder} ج.س` };
  }

  const usageLimit = coupon.usageLimit ?? 0;
  const usageCount = coupon.usageCount ?? 0;
  if (usageLimit > 0 && usageCount >= usageLimit) {
    return { valid: false, message: "تم استنفاد عدد مرات استخدام هذا الكود" };
  }

  const rawDiscount = coupon.discountType === "percentage"
    ? subtotal * (coupon.discountValue / 100)
    : coupon.discountValue;
  const discountAmount = Math.min(rawDiscount, subtotal);

  return { valid: true, discountAmount: Math.round(discountAmount * 100) / 100, coupon };
}

// ─── رابط إيصال الدفع ────────────────────────────────────────────────────
export const MAX_RECEIPT_URL_LENGTH = 2048;

export function isValidReceiptUrl(rawUrl: string, ownerUid: string, bucket?: string): boolean {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_RECEIPT_URL_LENGTH) return false;
  if (!ownerUid) return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") return false;
  if (url.username || url.password) return false;

  const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
  if (!match) return false;
  if (bucket && match[1] !== bucket) return false;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return false;
  }
  if (objectPath.includes("..")) return false;
  return objectPath.startsWith(`receipts/${ownerUid}/`) && objectPath.length > `receipts/${ownerUid}/`.length;
}
