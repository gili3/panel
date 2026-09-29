import { adminDb } from "./firebase-admin";

export type CouponDoc = {
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  isActive: boolean;
  minOrderAmount?: number;
  usageLimit?: number; // 0 or undefined = unlimited
  usageCount?: number;
  expiresAt?: FirebaseFirestore.Timestamp | null;
};

export type CouponCheckResult =
  | { valid: true; discountAmount: number; coupon: CouponDoc }
  | { valid: false; message: string };

/**
 * منطق التحقق من صلاحية الكوبون — نفس القواعد تُستخدم في:
 *  1) validateCoupon (معاينة فورية للمستخدم قبل إتمام الطلب)
 *  2) createOrder (التحقق النهائي + خصم الاستخدام، داخل transaction ذرّية)
 * حتى لا يختلف السلوك بين المعاينة والتنفيذ الفعلي.
 */
export function checkCoupon(coupon: CouponDoc | undefined, subtotal: number): CouponCheckResult {
  if (!coupon) return { valid: false, message: "كود الخصم غير صالح" };
  if (!coupon.isActive) return { valid: false, message: "كود الخصم غير مُفعّل حالياً" };

  if (coupon.expiresAt) {
    const expiry = coupon.expiresAt.toDate ? coupon.expiresAt.toDate() : new Date(coupon.expiresAt as any);
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

  // ✅ (Audit) خصم النسبة المئوية لم يكن مُقيَّداً بمجموع الطلب — خطأ كتابي في لوحة
  // التحكم (discountValue=500 بدل 50 مثلاً) كان يُنتج discountAmount أكبر من subtotal
  // نفسه، فيصبح إجمالي الطلب سالباً (calculateOrderTotal = subtotal - discount +
  // shipping). الآن كلا النوعين مقيَّد بحد أقصى = المجموع الفرعي (النوع "fixed" كان
  // مقيَّداً أصلاً بـMath.min؛ النسبة المئوية تنضم لنفس الحماية بلا استثناء).
  const rawDiscount = coupon.discountType === "percentage"
    ? subtotal * (coupon.discountValue / 100)
    : coupon.discountValue;
  const discountAmount = Math.min(rawDiscount, subtotal);

  return { valid: true, discountAmount: Math.round(discountAmount * 100) / 100, coupon };
}

/** جلب كوبون (خارج أي transaction) — يُستخدم فقط للمعاينة قبل إتمام الطلب. */
export async function fetchCoupon(code: string): Promise<CouponDoc | undefined> {
  const doc = await adminDb.collection("coupons").doc(code.trim().toUpperCase()).get();
  if (!doc.exists) return undefined;
  return doc.data() as CouponDoc;
}
