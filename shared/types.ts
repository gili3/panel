/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export * from "./_core/errors";

export type User = {
  id: string;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: 'user' | 'admin';
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export type Category = {
  id: string;
  name: string;
  description?: string;
  image?: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  basePrice: number; // السعر الأساسي
  price: number; // السعر النهائي (بعد الخصم)
  originalPrice?: number; // السعر الأصلي (نفس basePrice أو مختلف)
  categoryId: string;
  brandId?: string; // معرف العلامة التجارية
  images: string[];
  stock: number;
  sku?: string;
  isActive: boolean;
  isFeatured: boolean;
  isOnSale: boolean; // هل المنتج عليه عرض
  discountType?: 'percentage' | 'fixed'; // نوع الخصم
  discountValue?: number; // قيمة الخصم
  createdAt: Date;
  updatedAt: Date;
};

// ✅ إعادة تنظيم جذرية: كانت حالة الطلب (OrderStatus) وحالة الدفع
// (PaymentStatus سابقاً) حقلين منفصلين تماماً على نفس الطلب، معروضين
// كقائمتين منفصلتين بلوحة التحكم — ما كان يسبب تناقضات (مثال: طلب
// "ملغي" لكن حالة دفعه ما زالت "بانتظار المراجعة") وواجهة مربكة تحتاج
// لتحديث حقلين منفصلين لكل تغيير. الآن حقل واحد فقط (status) بستّ حالات
// مرتّبة تمثّل دورة حياة الطلب الكاملة (بما فيها فشل الدفع)، بلا أي حقل
// paymentStatus منفصل. راجع server/firestore-router.ts::updateOrderStatus
// وclient/src/lib/orderStatus.ts وapk Models.kt::OrderStatus (نفس القيم
// حرفياً في الثلاثة).
export type OrderStatus =
  | "under_review"     // قيد المراجعة — الحالة الابتدائية لكل طلب جديد
  | "processing"       // قيد التجهيز — تم تأكيد الدفع ويُجهَّز الطلب
  | "out_for_delivery" // قيد التوصيل
  | "delivered"        // تم التسليم
  | "cancelled"        // ملغي
  | "payment_failed";  // دفع فاشل

export type Order = {
  id: string;
  userId: string;
  orderNumber: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number; // سعر الوحدة وقت الطلب — الإجمالي = price × quantity
    image?: string; // صورة المنتج وقت الطلب (authoritativeItems بالسيرفر)
  }>;
  total: number;
  status: OrderStatus;
  paymentMethod?: string;
  paymentReceipt?: string;
  shippingAddress: any;
  // ✅ علامة داخلية تمنع إرجاع المخزون مرتين لنفس الطلب (إلغاء ثم حذف،
  // أو استدعاء مزدوج) — راجع updateOrderStatus وdeleteOrder بالسيرفر.
  stockRestored?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ─── نظام الإشعارات (Notifications) ─────────────────────────────
// مصدر الحقيقة الوحيد لشكل الإشعار عبر: السيرفر (notification-service.ts)،
// الموقع (Notifications.tsx / useNotifications.ts)، وتطبيق الأندرويد
// (NotificationItem بـ Models.kt يطابق هذه الحقول حرفياً).
// المستند الفعلي محفوظ في: users/{uid}/notifications/{id}
export type NotificationType = "order" | "shipping" | "promo" | "welcome" | "general";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  isRead: boolean;
  /** مسار داخلي يُفتح عند الضغط على الإشعار، مثال: "/order/abc123" */
  actionRoute?: string;
  /** رابط صورة اختيارية تُعرض مع الإشعار (بالأخص إشعارات العروض/promo) */
  imageUrl?: string;
  createdAt: Date;
};