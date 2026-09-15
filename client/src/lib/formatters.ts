/**
 * تنسيق الأرقام والعملات
 */

/**
 * تنسيق الرقم بفواصل الآلاف
 * @param num الرقم المراد تنسيقه
 * @param decimals عدد المنازل العشرية (افتراضي: 0)
 * @returns الرقم المنسق
 */
export function formatNumber(num: number, decimals: number = 0): string {
  if (!num && num !== 0) return "0";
  // ملاحظة: كانت تُستخدم "ar-EG" هنا، وهي تُخرج أرقاماً هندية شرقية
  // بفواصل عربية (١٬٢٣٤٫٥٦) — شكل مختلف تماماً عن تطبيق الأندرويد الذي
  // يعرض أرقاماً لاتينية. تم التحويل إلى "en-US" ليتطابق العرض 100%
  // بين لوحة التحكم والأندرويد (كلاهما الآن: أرقام لاتينية + فاصلة إنجليزية).
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
}

/**
 * تنسيق السعر بالعملة
 * @param price السعر
 * @param currency رمز العملة (افتراضي: ج.س)
 * @returns السعر المنسق
 */
export function formatPrice(price: number, currency: string = "ج.س"): string {
  const formatted = formatNumber(price, 2);
  return `${formatted} ${currency}`;
}

/**
 * تنسيق السعر بدون عملة (للعرض في الجداول)
 * @param price السعر
 * @returns السعر المنسق
 */
export function formatPriceSimple(price: number): string {
  return formatNumber(price, 0);
}

/**
 * تنسيق النسبة المئوية
 * @param percentage النسبة
 * @returns النسبة المنسقة
 */
export function formatPercentage(percentage: number): string {
  return `${formatNumber(percentage, 1)}%`;
}

/**
 * تنسيق الكمية
 * @param quantity الكمية
 * @returns الكمية المنسقة
 */
export function formatQuantity(quantity: number): string {
  return formatNumber(quantity, 0);
}

/**
 * تنسيق التاريخ بالعربية
 * @param date التاريخ
 * @returns التاريخ المنسق
 */
export function formatDate(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * تنسيق التاريخ والوقت
 * @param date التاريخ
 * @returns التاريخ والوقت المنسقان
 */
export function formatDateTime(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
