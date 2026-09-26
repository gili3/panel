// تعريف صلاحيات الأدمن — مصدر واحد يُستخدم على السيرفر (للتحقق) والواجهة
// (لإخفاء/إظهار أقسام اللوحة). أي قسم جديد يُضاف هنا أولاً.
export const ADMIN_PERMISSIONS = [
  "statistics",
  "products",
  "orders",
  "categories",
  "banners",
  "brands",
  "coupons",
  "settings",
  "users",
  "notifications",
  "contactMessages",
  "deliveryZones",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  statistics: "الإحصائيات",
  products: "المنتجات",
  orders: "الطلبات",
  categories: "التصنيفات",
  banners: "البانرات",
  brands: "العلامات",
  coupons: "الكوبونات",
  settings: "الإعدادات",
  users: "المستخدمين",
  notifications: "الإشعارات",
  contactMessages: "رسائل التواصل",
  deliveryZones: "مناطق التوصيل",
};

export function isValidAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}
