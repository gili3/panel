import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";

/**
 * تنظيف يومي لتنبيهات جرس لوحة التحكم (adminAlerts) — تُقرأ آخر 30 فقط
 * أصلاً بـserver/admin-alerts-router.ts، فمجموعة تكبر بلا حد ليس لها أي
 * فائدة قرائية، فقط تكلفة تخزين/فهرسة متراكمة بلا داعٍ.
 *
 * القاعدة (بطلب صاحب المتجر): يُحذف أي تنبيه أقدم من 14 يوماً، **إلا** لو
 * كان من ضمن أحدث 30 تنبيه على الإطلاق — فهذه الـ30 تبقى دائماً بصرف
 * النظر عن عمرها، حتى لا يظهر الجرس فارغاً تماماً بعد فترة هدوء طويلة
 * (متجر بلا طلبات/رسائل لأكثر من أسبوعين، مثلاً).
 */
const KEEP_RECENT_COUNT = 30;
const MAX_AGE_DAYS = 14;
const BATCH_SIZE = 400; // هامش أمان تحت حد 500 عملية بالمعاملة الواحدة بـFirestore

export const cleanupAdminAlerts = onSchedule(
  { schedule: "every 24 hours", timeZone: "Africa/Cairo" },
  async () => {
    const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    // ✅ حجم هذه المجموعة عملياً صغير (تنبيهات لوحة تحكم لا بيانات عملاء)،
    // فقراءة كاملة يومية بسيطة وآمنة — لا حاجة لتعقيد pagination هنا.
    const snapshot = await db.collection("adminAlerts").orderBy("createdAt", "desc").get();

    // أحدث KEEP_RECENT_COUNT مستند محفوظ دائماً بصرف النظر عن عمره؛ الباقي
    // فقط هو المرشّح للحذف، وبشرط أن يكون أقدم فعلاً من MAX_AGE_DAYS.
    const candidates = snapshot.docs.slice(KEEP_RECENT_COUNT);
    const toDelete = candidates.filter((doc) => {
      const createdAt = doc.data().createdAt as Timestamp | undefined;
      return createdAt ? createdAt.toMillis() < cutoffMs : false;
    });

    if (toDelete.length === 0) {
      console.log("[cleanupAdminAlerts] لا يوجد شيء للحذف اليوم");
      return;
    }

    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of toDelete.slice(i, i + BATCH_SIZE)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    console.log(`[cleanupAdminAlerts] تم حذف ${toDelete.length} تنبيهاً أقدم من ${MAX_AGE_DAYS} يوماً`);
  }
);
