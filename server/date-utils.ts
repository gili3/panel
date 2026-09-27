// ELEVEN STORE — أدوات تاريخ مشتركة بين راوترات السيرفر
// ─────────────────────────────────────────────────────────────────────────
// ✅ مستخرجة من firestore-router.ts لإعادة استخدامها بـdelivery-zone-router.ts
// (خريطة الطلبات المجمّعة + تفاصيل الطلب) بدل تكرار نفس المنطق.

// بعض المستندات (خصوصاً ما يُكتب مباشرة من تطبيق الأندرويد عبر Client SDK)
// قد يكون فيها createdAt/updatedAt مفقوداً أو غير صالح كتاريخ.
// new Date(undefined).toISOString() يرمي RangeError: "Invalid time value"
// ويكسر الطلب بالكامل. هذه الدالة تتعامل بأمان مع كل الحالات الممكنة
// وتُرجع null بدلاً من الانهيار.
export function toIsoStringSafe(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as any).toDate === "function") {
    const d = (value as any).toDate();
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value as any);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
