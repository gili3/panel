import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";

/**
 * تنظيف يومي لتنبيهات جرس لوحة التحكم (adminAlerts) — تُقرأ آخر 30 فقط
 * أصلاً بحسب limit() بـclient/src/hooks/useAdminAlerts.ts، فمجموعة تكبر
 * بلا حد ليس لها أي فائدة قرائية، فقط تكلفة تخزين/فهرسة متراكمة بلا داعٍ.
 *
 * القاعدة (بطلب صاحب المتجر): يُحذف أي تنبيه أقدم من 14 يوماً، **إلا** لو
 * كان من ضمن أحدث 30 تنبيه على الإطلاق — فهذه الـ30 تبقى دائماً بصرف
 * النظر عن عمرها، حتى لا يظهر الجرس فارغاً تماماً بعد فترة هدوء طويلة
 * (متجر بلا طلبات/رسائل لأكثر من أسبوعين، مثلاً).
 *
 * ✅ v2: كل تنبيه محذوف من المستند العلوي يُحذف أيضاً من نسخ الفان-آوت
 * لدى كل أدمن (users/{uid}/adminAlerts/{alertId}) عبر استعلام
 * collectionGroup بحقل alertId — بدون هذا كانت نسخ الأدمنز تتراكم للأبد
 * بلا أي تنظيف مقابل (limit(30) بالقراءة يخفي التراكم عن العين لكن لا
 * يمنعه فعلياً).
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

    await deleteFanOutCopies(toDelete.map((doc) => doc.id));

    console.log(`[cleanupAdminAlerts] تم حذف ${toDelete.length} تنبيهاً أقدم من ${MAX_AGE_DAYS} يوماً`);
  }
);

// حد عملياً لعامل 'in' بـFirestore — نجزّئ معرّفات التنبيهات المحذوفة لدفعات
// آمنة (10 حالياً، أقل من أي حد معروف لأي إصدار SDK/Firestore).
const IN_CHUNK_SIZE = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** يحذف نسخ الفان-آوت (users/*\/adminAlerts/{alertId}) المطابقة لهذه المعرّفات لدى كل الأدمنز، عبر collectionGroup + حقل alertId. */
async function deleteFanOutCopies(alertIds: string[]): Promise<void> {
  if (alertIds.length === 0) return;
  for (const idsChunk of chunk(alertIds, IN_CHUNK_SIZE)) {
    const snapshot = await db
      .collectionGroup("adminAlerts")
      .where("alertId", "in", idsChunk)
      .get();
    if (snapshot.empty) continue;
    for (const batchDocs of chunk(snapshot.docs, BATCH_SIZE)) {
      const batch = db.batch();
      for (const doc of batchDocs) batch.delete(doc.ref);
      await batch.commit();
    }
  }
}
