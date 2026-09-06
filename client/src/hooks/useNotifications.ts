import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import type { AppNotification, NotificationType } from "@shared/types";

const NOTIFICATIONS_LIMIT = 50;

type RawNotificationDoc = {
  title?: string;
  body?: string;
  type?: NotificationType;
  isRead?: boolean;
  actionRoute?: string;
  createdAt?: { toDate?: () => Date } | Date | null;
};

function toDate(value: RawNotificationDoc["createdAt"]): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  return new Date();
}

/**
 * ELEVEN STORE — مركز الإشعارات (v2)
 * ─────────────────────────────────────────────────────────
 * يقرأ مباشرة من Firestore عبر onSnapshot (نفس مسار وأسلوب تطبيق الأندرويد:
 * observeNotifications) بدل الاعتماد على polling عبر tRPC كل عدة ثوانٍ —
 * أي إشعار جديد يظهر لحظياً بدون أي تأخير، بصرف النظر عن وصول Push أم لا.
 * التعديلات (تحديد كمقروء/حذف) تمرّ عبر tRPC لأنها تتطلب تحقق ملكية صريح
 * من السيرفر (ونظام v2 يمنع أي كتابة مباشرة من العميل بقواعد الأمان أصلاً).
 *
 * ✅ إصلاح جوهري v2 — عدّاد غير المقروء: كان يُحسب سابقاً بعدّ عناصر نفس
 * القائمة المحمَّلة محلياً (`notifications.filter(!isRead).length`)، وهي
 * محدودة بـlimit(50) — أي مستخدم لديه أكثر من 50 إشعاراً غير مقروء كان
 * يرى رقماً أصغر من الحقيقة على جرس الإشعارات. الآن نشترك مباشرة بحقل
 * `users/{uid}.notifUnreadCount` الذي يحسبه السيرفر ذرّياً مع كل إنشاء/
 * تعليم كمقروء/حذف (بصرف النظر عن limit القائمة)، فيتطابق الرقم المعروض
 * تماماً مع تطبيق الأندرويد الذي يقرأ نفس الحقل بالضبط.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const q = query(
      collection(db, "users", user.id, "notifications"),
      orderBy("createdAt", "desc"),
      limit(NOTIFICATIONS_LIMIT)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: AppNotification[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as RawNotificationDoc;
          return {
            id: docSnap.id,
            title: data.title || "",
            body: data.body || "",
            type: (data.type as NotificationType) || "general",
            isRead: !!data.isRead,
            actionRoute: data.actionRoute,
            createdAt: toDate(data.createdAt),
          };
        });
        setNotifications(items);
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        console.error("[useNotifications] onSnapshot failed:", err);
        setError(err as unknown as Error);
        setIsLoading(false);
      }
    );
    return unsubscribe;
  }, [user?.id]);

  // اشتراك مستقل بعدّاد غير المقروء الحقيقي (users/{uid}.notifUnreadCount) —
  // مستقل تماماً عن استعلام القائمة أعلاه، ويبقى صحيحاً حتى لو تجاوز عدد
  // الإشعارات غير المقروءة حد الـlimit(50) بالقائمة.
  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, "users", user.id),
      (snap) => {
        const value = snap.data()?.notifUnreadCount;
        setUnreadCount(typeof value === "number" && value > 0 ? value : 0);
      },
      (err) => console.error("[useNotifications] unread counter listener failed:", err)
    );
    return unsubscribe;
  }, [user?.id]);

  const markReadMutation = trpc.firestore.markNotificationRead.useMutation();
  const markAllReadMutation = trpc.firestore.markAllNotificationsRead.useMutation();
  const deleteMutation = trpc.firestore.deleteNotification.useMutation();
  const deleteAllMutation = trpc.firestore.deleteAllNotifications.useMutation();

  // تحديث متفائل محلي فوري (قائمة + عدّاد) — onSnapshot لكليهما سيعيد
  // تأكيد نفس القيمة من السيرفر خلال لحظات على أي حال، فهذا فقط لإخفاء
  // زمن استجابة الشبكة عن المستخدم، وليس مصدر الحقيقة.
  const markRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === id);
        if (target && !target.isRead) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      });
      markReadMutation.mutate({ id });
    },
    [markReadMutation]
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    markAllReadMutation.mutate();
  }, [markAllReadMutation]);

  const remove = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === id);
        if (target && !target.isRead) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return prev.filter((n) => n.id !== id);
      });
      deleteMutation.mutate({ id });
    },
    [deleteMutation]
  );

  const removeAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
    deleteAllMutation.mutate();
  }, [deleteAllMutation]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    markRead,
    markAllRead,
    remove,
    removeAll,
  };
}

/**
 * يكشف فقط الإشعارات "الجديدة" التي وصلت بعد أول تحميل — يُستخدم لعرض Toast
 * فوري عند وصول إشعار والموقع مفتوح، بصرف النظر عن نجاح تسليم الـPush.
 */
export function useNewNotificationWatcher(
  notifications: AppNotification[],
  onNew: (n: AppNotification) => void
) {
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenIds.current === null) {
      seenIds.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const newOnes = notifications.filter((n) => !seenIds.current!.has(n.id));
    newOnes.forEach(onNew);
    seenIds.current = new Set(notifications.map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications]);
}
