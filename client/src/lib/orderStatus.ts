/**
 * ELEVEN STORE — حالة الطلب (Source of Truth)
 * ─────────────────────────────────────────────────────────────
 * ✅ إصلاح جذري: كانت ألوان/تسميات حالة الطلب مكرَّرة ومختلفة في عدة
 * أماكن منفصلة بلوحة التحكم — كل ملف له تدرّج ألوان Tailwind مختلف
 * تماماً (bg-yellow-100 مقابل bg-warning/10 مقابل bg-blue-100 لنفس
 * الحالة!). هذا يعني أن نفس حالة الطلب تظهر بلون مختلف حسب الصفحة التي
 * يراها المستخدم — تناقض بصري واضح.
 *
 * ✅ إعادة تنظيم جذرية أخرى: كانت حالة الطلب (status) وحالة الدفع
 * (paymentStatus) حقلين منفصلين تماماً — قائمتان مستقلتان بواجهة الأدمن
 * لنفس الطلب، ما كان يسبب تناقضات (طلب "ملغي" لكن دفعه لا يزال "بانتظار
 * المراجعة") ويتطلب تحديث حقلين منفصلين لكل تغيير حالة. الآن حقل واحد
 * فقط (status) بستّ حالات مرتّبة تغطي دورة حياة الطلب كاملة، بما فيها
 * فشل الدفع:
 *   1) قيد المراجعة   2) قيد التجهيز   3) قيد التوصيل
 *   4) تم التسليم     5) ملغي         6) دفع فاشل
 *
 * كل الملفات تستورد من هنا فقط، وتستخدم القيم الست عشرية (Hex) الثابتة
 * المطلوبة تحديداً عبر inline style بدل className، لضمان أن اللون يبقى
 * مطابقاً 100% بصرف النظر عن أي تعديل مستقبلي على ثيم Tailwind. نفس هذه
 * القيم مطابقة حرفياً في تطبيق الأندرويد (OrderStatusColors في Theme.kt).
 */
import { ORDER_STATUS_COLORS, type OrderStatusKey } from "./colors";

export const ORDER_STATUS_LABELS: Record<OrderStatusKey, string> = {
  under_review: "قيد المراجعة",
  processing: "قيد التجهيز",
  out_for_delivery: "قيد التوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  payment_failed: "دفع فاشل",
};

// ✅ الترتيب الرسمي المعتمد لحالات الطلب — نفس الترتيب يُستخدم لبناء
// أزرار الفلترة بلوحة التحكم وقائمة اختيار الحالة، بدل تكرار نفس المصفوفة
// يدوياً في كل مكان.
export const ORDER_STATUS_ORDER: OrderStatusKey[] = [
  "under_review",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "payment_failed",
];

export interface OrderStatusConfig {
  label: string;
  style: { backgroundColor: string; color: string };
}

/** يُرجع التسمية العربية + ستايل الألوان الثابت لحالة طلب معيّنة. */
export function getOrderStatusConfig(status: string): OrderStatusConfig {
  const key = status as OrderStatusKey;
  const colors = ORDER_STATUS_COLORS[key];
  if (!colors) {
    // حالة غير معروفة (مثال: بيانات قديمة لم تُهاجَر بعد) — نفس منطق
    // fallback القديم، لكن كخلفية محايدة ثابتة بدل كسر الواجهة.
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

export const ORDER_STATUS_OPTIONS: { value: OrderStatusKey; label: string }[] =
  ORDER_STATUS_ORDER.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));
