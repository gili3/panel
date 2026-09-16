import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  getCurrentPermissionState,
  enablePushNotificationsWithRetry,
} from "@/lib/push";

const DISMISS_KEY = "eleven-store-push-banner-dismissed";

/**
 * ✅ جديد: شريط طلب تفعيل الإشعارات — يظهر بارزاً أعلى اللوحة مباشرة بعد
 * تسجيل الدخول (بدل الاعتماد فقط على تنبيه صغير مطويّ داخل نافذة الجرس،
 * والذي لا يراه كثير من الأدمنز لأنهم لا يفتحون الجرس أصلاً قبل وصول أول
 * تنبيه). هذا يقارب تجربة تطبيق الأندرويد الذي يطلب إذن الإشعارات فور أول
 * تشغيل — يبقى الفارق التقني الوحيد أن المتصفح يرفض طلب الإذن تلقائياً بلا
 * ضغطة مستخدم صريحة (راجع تعليق lib/push.ts)، فهذا الشريط هو أقرب بديل ممكن:
 * ضغطة واحدة واضحة بدل التنقيب عن الخيار.
 *
 * يُخفى نهائياً بعد أول قرار حاسم (منح/رفض الإذن) لأن Notification.permission
 * وقتها لم يعد "default" أصلاً. "تجاهل الآن" يُخفيه لهذا المتصفح فقط (localStorage)
 * دون التأثير على الإذن نفسه — يظهر مجدداً لو مُسحت بيانات الموقع.
 */
export default function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const updateFcmToken = trpc.firestore.updateFcmToken.useMutation();

  useEffect(() => {
    const dismissed = typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1";
    setVisible(!dismissed && getCurrentPermissionState() === "default");
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const handleEnable = async () => {
    setEnabling(true);
    try {
      const result = await enablePushNotificationsWithRetry(updateFcmToken);
      if (result.ok) {
        toast.success("تم تفعيل إشعارات اللوحة على هذا الجهاز");
        setVisible(false);
      } else if (result.reason === "denied") {
        toast.error("تم رفض إذن الإشعارات — يمكن تفعيله لاحقاً من إعدادات المتصفح");
        setVisible(false);
      } else if (result.reason === "unsupported-browser") {
        toast.error("هذا المتصفح لا يدعم إشعارات الـPush");
        setVisible(false);
      } else {
        toast.error("تعذّر تفعيل الإشعارات، حاول مرة أخرى");
      }
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-primary/10 border-b text-sm">
      <span className="flex items-center gap-2">
        <BellRing className="w-4 h-4 shrink-0 text-primary" />
        فعّل إشعارات اللوحة على هذا الجهاز حتى تصلك الطلبات والرسائل فوراً — حتى لو اللوحة مغلقة
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" className="h-7 text-xs" onClick={handleEnable} disabled={enabling}>
          {enabling ? "جارٍ التفعيل..." : "تفعيل الآن"}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={dismiss} aria-label="تجاهل">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
