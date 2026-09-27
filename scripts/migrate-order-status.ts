/**
 * سكربت لمرة واحدة: يهاجر كل مستندات "orders" الموجودة حالياً في Firestore
 * من النظام القديم (حقلا status + paymentStatus منفصلان) إلى النظام
 * الموحّد الجديد (حقل status واحد فقط بستّ حالات) — راجع
 * shared/types.ts::OrderStatus وclient/src/lib/orderStatus.ts.
 *
 * منطق التحويل (بالأولوية من الأعلى للأسفل — أول شرط ينطبق يُستخدم):
 *   1) status == "cancelled"                      → cancelled       (نهائية، تبقى كما هي)
 *   2) status == "delivered"                       → delivered      (نهائية، تبقى كما هي)
 *   3) status == "shipped"                          → out_for_delivery
 *   4) paymentStatus == "failed"                    → payment_failed
 *   5) paymentStatus == "paid" (أو status=="paid")  → processing
 *   6) غير ذلك (pending/unpaid/pending_review)      → under_review
 *
 * تشغيل تجريبي بلا كتابة فعلية (لمراجعة النتائج أولاً):
 *   npx tsx scripts/migrate-order-status.ts --dry-run
 * تشغيل فعلي:
 *   FIREBASE_SERVICE_ACCOUNT='...' npx tsx scripts/migrate-order-status.ts
 */
import { adminDb } from "../server/firebase-admin";
import admin from "firebase-admin";

const VALID_NEW_STATUSES = new Set([
  "under_review",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "payment_failed",
]);

function mapToNewStatus(oldStatus: unknown, oldPaymentStatus: unknown): string {
  const status = typeof oldStatus === "string" ? oldStatus : "";
  const paymentStatus = typeof oldPaymentStatus === "string" ? oldPaymentStatus : "";

  if (status === "cancelled") return "cancelled";
  if (status === "delivered") return "delivered";
  if (status === "shipped") return "out_for_delivery";
  if (paymentStatus === "failed") return "payment_failed";
  if (paymentStatus === "paid" || status === "paid") return "processing";
  return "under_review";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "🧪 تشغيل تجريبي (بلا كتابة فعلية)..." : "🚀 بدء الهجرة الفعلية...");

  const snapshot = await adminDb.collection("orders").get();
  console.log(`📦 وُجد ${snapshot.size} طلب.`);

  let migrated = 0;
  let alreadyUnified = 0;
  let batch = adminDb.batch();
  let opsInBatch = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // ✅ طلب هُوجر مسبقاً (حالته أصلاً إحدى القيم الست الجديدة ولا يوجد حقل
    // paymentStatus قديم متبقٍّ) — لا حاجة لإعادة معالجته، يمنع تشغيل
    // السكربت مرتين من كسر بيانات صحيحة أصلاً.
    if (VALID_NEW_STATUSES.has(data.status) && data.paymentStatus === undefined) {
      alreadyUnified++;
      continue;
    }

    const newStatus = mapToNewStatus(data.status, data.paymentStatus);
    console.log(
      `  ${doc.id}: status="${data.status}" paymentStatus="${data.paymentStatus}" → "${newStatus}"`
    );

    if (!dryRun) {
      batch.update(doc.ref, {
        status: newStatus,
        // حذف الحقل القديم نهائياً بدل تركه متبقياً بلا استخدام بالمستند
        paymentStatus: admin.firestore.FieldValue.delete(),
      });
      opsInBatch++;
      if (opsInBatch >= 400) {
        await batch.commit();
        batch = adminDb.batch();
        opsInBatch = 0;
      }
    }
    migrated++;
  }

  if (!dryRun && opsInBatch > 0) {
    await batch.commit();
  }

  console.log(
    `✅ انتهت الهجرة: ${migrated} طلب ${dryRun ? "سيُحدَّث" : "تم تحديثه"}، ${alreadyUnified} طلب كان موحّداً مسبقاً.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ فشلت الهجرة:", err);
    process.exit(1);
  });
