import {
  BarChart3, Package, ShoppingBag, Tag, Image as ImageIcon,
  Star, Percent, Settings, Users, Bell,
} from "lucide-react";
import type { AdminPermission } from "@shared/adminPermissions";

export type AdminSection = {
  key: string;
  path: string;
  label: string;
  icon: typeof BarChart3;
  // null = متاح لأي أدمن بصرف النظر عن الصلاحيات التفصيلية
  permission: AdminPermission | null;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "overview", path: "/", label: "نظرة عامة", icon: BarChart3, permission: null },
  { key: "products", path: "/products", label: "المنتجات", icon: Package, permission: "products" },
  { key: "orders", path: "/orders", label: "الطلبات", icon: ShoppingBag, permission: "orders" },
  { key: "categories", path: "/categories", label: "التصنيفات", icon: Tag, permission: "categories" },
  { key: "banners", path: "/banners", label: "البانرات", icon: ImageIcon, permission: "banners" },
  { key: "brands", path: "/brands", label: "العلامات", icon: Star, permission: "brands" },
  { key: "coupons", path: "/coupons", label: "الكوبونات", icon: Percent, permission: "coupons" },
  { key: "settings", path: "/settings", label: "الإعدادات", icon: Settings, permission: "settings" },
  { key: "users", path: "/users", label: "المستخدمين", icon: Users, permission: "users" },
  { key: "notifications", path: "/notifications", label: "الإشعارات", icon: Bell, permission: "notifications" },
];

export function userHasAdminPermission(
  user: { isSuperAdmin?: boolean; permissions?: string[] } | null | undefined,
  permission: AdminPermission | null
): boolean {
  if (!user) return false;
  if (permission === null) return true;
  if (user.isSuperAdmin) return true;
  return Boolean(user.permissions?.includes(permission));
}
