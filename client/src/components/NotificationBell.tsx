import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCheck, PackageOpen, Mail, Circle, PackageX } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getCurrentPermissionState,
  enablePushNotificationsWithRetry,
  type PushPermissionState,
} from "@/lib/push";

// جرس تنبيهات لوحة التحكم (طلبات جديدة + رسائل تواصل جديدة، الخ...).
// يعتمد على polling بسيط (لا اشتراك Firestore حي بعد) — كافٍ لواجهة إدارية
// وليست تطبيق دردشة، ويتجنب فتح اتصال Firestore إضافي فوق كل ما هو موجود
// أصلاً بـuseAuth (onSnapshot لمستند المستخدم). القراءة والفلترة حسب
// الصلاحيات تتم بالكامل بالسيرفر (راجع server/admin-alerts-router.ts).
const ALERT_ICON: Record<string, typeof PackageOpen> = {
  order: PackageOpen,
  contactMessage: Mail,
  // ✅ جديد: تنبيه المخزون المنخفض اليومي (functions/src/scheduled/lowStockAlert.ts)
  lowStock: PackageX,
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default function NotificationBell() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.adminAlerts.list.useQuery(undefined, {
    // ✅ "جرس حقيقي" بدون websocket مخصص: إعادة جلب دورية + عند رجوع
    // التركيز للتبويب، بما يكفي لظهور تنبيه خلال ثوانٍ من وصوله فعلياً.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const markRead = trpc.adminAlerts.markRead.useMutation({
    onSuccess: () => utils.adminAlerts.list.invalidate(),
  });
  const markAllRead = trpc.adminAlerts.markAllRead.useMutation({
    onSuccess: () => utils.adminAlerts.list.invalidate(),
  });

  // ✅ جديد: تفعيل Push فعلياً من هنا — قبل هذا لم يكن هناك أي زر بكامل
  // اللوحة يستدعي enablePushNotifications، فبقيت كل بنية الـPush (بما فيها
  // Push الجرس المُضاف حديثاً) بلا أي طريقة عملية ليحصل عليها الأدمن أصلاً؛
  // كان الإذن يبقى "default" للأبد بلا أي طلب صريح. الحالة تُقرأ عند فتح
  // القائمة (وليس عند كل render) لأن Notification.permission لا يتغيّر إلا
  // بفعل المستخدم نفسه من إعدادات المتصفح أو من هذا الزر.
  const [permissionState, setPermissionState] = useState<PushPermissionState>("default");
  const [enabling, setEnabling] = useState(false);
  const updateFcmToken = trpc.firestore.updateFcmToken.useMutation();

  useEffect(() => {
    setPermissionState(getCurrentPermissionState());
  }, []);

  const handleEnableNotifications = async () => {
    setEnabling(true);
    try {
      const result = await enablePushNotificationsWithRetry(updateFcmToken);
      setPermissionState(getCurrentPermissionState());
      if (result.ok) {
        toast.success("تم تفعيل تنبيهات الجرس على هذا الجهاز");
      } else if (result.reason === "denied") {
        toast.error("تم رفض إذن الإشعارات — يمكن تفعيله لاحقاً من إعدادات المتصفح");
      } else if (result.reason === "unsupported-browser") {
        toast.error("هذا المتصفح لا يدعم إشعارات الـPush");
      } else {
        toast.error("تعذّر تفعيل الإشعارات، حاول مرة أخرى");
      }
    } finally {
      setEnabling(false);
    }
  };

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const handleItemClick = (item: (typeof items)[number]) => {
    if (!item.isRead) markRead.mutate({ ids: [item.id] });
    if (item.actionRoute) setLocation(item.actionRoute);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="التنبيهات">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -left-1 h-5 min-w-5 px-1 flex items-center justify-center text-[10px]"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm">التنبيهات</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="w-3.5 h-3.5 ml-1" />
              تعليم الكل كمقروء
            </Button>
          )}
        </div>
        {permissionState === "default" && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-primary/5 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <BellRing className="w-3.5 h-3.5 shrink-0" />
              فعّل تنبيهات هذا الجهاز حتى تصلك حتى لو اللوحة مغلقة
            </span>
            <Button
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={handleEnableNotifications}
              disabled={enabling}
            >
              {enabling ? "جارٍ التفعيل..." : "تفعيل"}
            </Button>
          </div>
        )}
        {permissionState === "denied" && (
          <div className="px-3 py-2 border-b bg-destructive/5 text-xs text-muted-foreground">
            تم رفض إذن الإشعارات على هذا الجهاز — فعّله من إعدادات المتصفح لتصلك التنبيهات كـPush.
          </div>
        )}
        <ScrollArea className="h-96">
          {isLoading && (
            <p className="text-center text-sm text-muted-foreground py-8">جارٍ التحميل...</p>
          )}
          {!isLoading && items.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد تنبيهات بعد</p>
          )}
          {items.map((item) => {
            const Icon = ALERT_ICON[item.type] ?? Bell;
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`w-full text-right flex gap-2 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/60 transition-colors ${
                  item.isRead ? "" : "bg-primary/5"
                }`}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {!item.isRead && <Circle className="w-2 h-2 fill-primary text-primary shrink-0" />}
                    <span className="text-sm font-medium truncate">{item.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{item.body}</p>
                  <span className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
