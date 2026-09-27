/**
 * ELEVEN STORE — حالة الطلب (Source of Truth)
 * ─────────────────────────────────────────────────────────────
 * ✅ إصلاح جذري: كانت ألوان/تسميات حالة الطلب مكرَّرة ومختلفة في 4
 * أماكن منفصلة (Orders.tsx, OrderDetail.tsx, VerifyOrder.tsx,
 * AdminDashboard.tsx) — كل ملف له تدرّج ألوان Tailwind مختلف تماماً
 * (bg-yellow-100 مقابل bg-warning/10 مقابل bg-blue-100 لنفس الحالة!).
 * هذا يعني أن نفس حالة الطلب تظهر بلون مختلف حسب الصفحة التي يراها
 * المستخدم — تناقض بصري واضح.
 *
 * الآن كل الملفات تستورد من هنا فقط، وتستخدم القيم الست عشرية (Hex)
 * الثابتة المطلوبة تحديداً عبر inline style بدل className، لضمان أن
 * اللون يبقى مطابقاً 100% بصرف النظر عن أي تعديل مستقبلي على ثيم
 * Tailwind. نفس هذه القيم مطابقة حرفياً في تطبيق الأندرويد
 * (OrderStatusColors في Theme.kt).
 */
import { ORDER_STATUS_COLORS, type OrderStatusKey, PAYMENT_STATUS_COLORS, type PaymentStatusKey } from "./colors";

export const ORDER_STATUS_LABELS: Record<OrderStatusKey, string> = {
  pending: "قيد الانتظار",
  paid: "تم الدفع",
  shipped: "خرج للتوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

export interface OrderStatusConfig {
  label: string;
  style: { backgroundColor: string; color: string };
}

/** يُرجع التسمية العربية + ستايل الألوان الثابت لحالة طلب معيّنة. */
export function getOrderStatusConfig(status: string): OrderStatusConfig {
  const key = status as OrderStatusKey;
  const colors = ORDER_STATUS_COLORS[key];
  if (!colors) {
    // حالة غير معروفة — نفس منطق fallback القديم، لكن كخلفية محايدة ثابتة
    return {
      label: status,
      style: { backgroundColor: "#F3F4F6", color: "#000000" },
    };
  }
  return {
    label: ORDER_STATUS_LABELS[key],
    style: { backgroundColor: colors.bg, color: colors.fg },
  };
}

export const ORDER_STATUS_OPTIONS: { value: OrderStatusKey; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatusKey[]
).map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));

// ── حالة الدفع — مصدر الحقيقة الوحيد، منفصل عن حالة الطلب أعلاه ─────
// ✅ إصلاح: "pending_review" كانت مقبولة بواجهة OrderStatusDialog لكن
// مرفوضة بـZod enum على السيرفر (updateOrderStatus) — أي حفظ لها كان يفشل
// بصمت (خطأ تحقق من tRPC). الآن القيمة معتمدة رسمياً بكل الطبقات الثلاث:
// النوع المشترك (shared/types.ts)، Zod (server/firestore-router.ts)، والواجهة هنا.
export const PAYMENT_STATUS_LABELS: Record<PaymentStatusKey, string> = {
  unpaid: "غير مدفوع",
  pending_review: "بانتظار المراجعة",
  paid: "تم الدفع",
  failed: "فشل الدفع",
};

export interface PaymentStatusConfig {
  label: string;
  style: { backgroundColor: string; color: string };
}

/** يُرجع التسمية العربية + ستايل الألوان الثابت لحالة دفع معيّنة. */
export function getPaymentStatusConfig(status: string): PaymentStatusConfig {
  const key = status as PaymentStatusKey;
  const colors = PAYMENT_STATUS_COLORS[key];
  if (!colors) {
    return { label: status, style: { backgroundColor: "#F3F4F6", color: "#000000" } };
  }
  return { label: PAYMENT_STATUS_LABELS[key], style: { backgroundColor: colors.bg, color: colors.fg } };
}

export const PAYMENT_STATUS_OPTIONS: { value: PaymentStatusKey; label: string }[] = (
  Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatusKey[]
).map((value) => ({ value, label: PAYMENT_STATUS_LABELS[value] }));
