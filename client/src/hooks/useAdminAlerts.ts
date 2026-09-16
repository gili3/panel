import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/_core/hooks/useAuth";

const ALERTS_LIMIT = 30;

export type AdminAlertType = "order" | "contactMessage" | "lowStock";

export interface AdminAlertItem {
  id: string;
  type: AdminAlertType;
  title: string;
  body: string;
  actionRoute: string | null;
  isRead: boolean;
  createdAt: string | null; // ISO — نفس الشكل الذي كانت trpc.adminAlerts.list تُرجعه سابقاً
}

type RawDoc = {
  type?: AdminAlertType;
  title?: string;
  body?: string;
  actionRoute?: string | null;
  isRead?: boolean;
  createdAt?: { toDate?: () => Date } | null;
};

/**
 * ELEVEN STORE — جرس تنبيهات لوحة التحكم (v2)
 * ─────────────────────────────────────────────────────────
 * يشترك حياً بـusers/{uid}/adminAlerts عبر onSnapshot — فان-آوت يكتبه
 * Admin SDK لكل أدمن معنيّ وقت إنشاء التنبيه (functions/src/lib/adminAlerts.ts)
 * أو عند منح صلاحية جديدة (server/admin-alerts-backfill.ts). هذا يستبدل
 * تماماً trpc.adminAlerts.list + refetchInterval(20_000) القديم: لا مزيد من
 * تأخير الـ20 ثانية، ولا مزيد من اعتماد ظهور التنبيه داخل اللوحة على تركيز
 * التبويب (refetchOnWindowFocus) — أي تنبيه جديد يظهر فور وصوله للمستند،
 * سواء كانت اللوحة مفتوحة بالخلفية أو بالمقدمة (Push المنفصل عبر
 * firebase-messaging-sw.js يبقى مسؤولاً فقط عن حالة التبويب/المتصفح مغلقاً
 * تماماً).
 *
 * markRead/markAllRead كتابات Firestore مباشرة (لا tRPC) — onSnapshot أدناه
 * سيعكس القيمة الجديدة تلقائياً حتى قبل تأكيد السيرفر (Firestore SDK يطبّق
 * الكتابة على الكاش المحلي فوراً)، فلا حاجة لأي تحديث متفائل يدوي كما كان
 * بالنسخة القديمة عبر tRPC.
 */
export function useAdminAlerts() {
  const { user } = useAuth();
  const [items, setItems] = useState<AdminAlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const q = query(
      collection(db, "users", user.id, "adminAlerts"),
      orderBy("createdAt", "desc"),
      limit(ALERTS_LIMIT)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setItems(
          snapshot.docs.map((d) => {
            const data = d.data() as RawDoc;
            return {
              id: d.id,
              type: data.type || "order",
              title: data.title || "",
              body: data.body || "",
              actionRoute: data.actionRoute ?? null,
              isRead: !!data.isRead,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
            };
          })
        );
        setIsLoading(false);
      },
      (err) => {
        console.error("[useAdminAlerts] onSnapshot failed:", err);
        setIsLoading(false);
      }
    );
    return unsubscribe;
  }, [user?.id]);

  const markRead = useCallback(
    (id: string) => {
      if (!user?.id) return;
      updateDoc(doc(db, "users", user.id, "adminAlerts", id), {
        isRead: true,
        readAt: serverTimestamp(),
      }).catch((err) => console.error("[useAdminAlerts] markRead failed:", err));
    },
    [user?.id]
  );

  const markAllRead = useCallback(() => {
    if (!user?.id) return;
    const unread = items.filter((i) => !i.isRead);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const item of unread) {
      batch.update(doc(db, "users", user.id, "adminAlerts", item.id), {
        isRead: true,
        readAt: serverTimestamp(),
      });
    }
    batch.commit().catch((err) => console.error("[useAdminAlerts] markAllRead failed:", err));
  }, [user?.id, items]);

  const unreadCount = items.filter((i) => !i.isRead).length;

  return { items, unreadCount, isLoading, markRead, markAllRead };
}
