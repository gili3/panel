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

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export type Order = {
  id: string;
  userId: string;
  orderNumber: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  status: OrderStatus;
  paymentStatus: "unpaid" | "paid" | "failed";
  paymentMethod?: string;
  paymentReceipt?: string;
  shippingAddress: any;
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