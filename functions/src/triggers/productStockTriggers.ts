import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { createAdminAlert } from "../lib/adminAlerts";
import { db } from "../lib/admin";

/**
 * تنبيه فوري بلحظة عبور منتج لحد المخزون المنخفض — بالإضافة إلى (وليس
 * بديلاً عن) scheduled/lowStockAlert.ts اليومي:
 *   - هذا الـtrigger يلتقط اللحظة الفعلية التي ينخفض فيها مخزون منتج بعينه
 *     تحت الحد، أياً كان مصدر الكتابة على products/{productId} (بيع عبر
 *     الموقع/الأندرويد، تعديل يدوي بلوحة التحكم، استيراد جماعي...) —
 *     الاعتماد على trigger على المجموعة نفسها بدل كل نقطة كتابة على حدة
 *     نفس فلسفة orderTriggers.ts وcontactMessageTriggers.ts بالضبط.
 *   - اليومي يبقى شبكة أمان لأي منتج تحت الحد لسبب لا يمر بهذا الـtrigger
 *     (مثال: تخفيض قيمة lowStockThreshold نفسها بالإعدادات، فيصبح منتج لم
 *     يتغيّر مخزونه إطلاقاً "منخفضاً" فجأة دون أي كتابة على مستنده).
 *
 * ✅ لا يُطلَق عند كل كتابة على منتج تحت الحد أصلاً (مثال: تعديل سعر فقط) —
 * فقط عند "العبور" الفعلي من فوق الحد إلى تحته أو يساويه (أو كان غير نشط
 * وأصبح نشطاً بمخزون منخفض بالفعل).
 *
 * ⚠️ dedupeKey مبني من (before.stock, after.stock) — إعادة تنفيذ نفس الحدث
 * (retry من Cloud Functions) تنتج نفس المفتاح فلا يتكرر التنبيه. الأثر
 * الجانبي النادر: لو منتج عبر من نفس القيمتين بالضبط مرتين (نفدَ ثم أُعيد
 * تخزينه لنفس رقم البداية بالصدفة ثم نفد لنفس رقم النهاية بالضبط)، التنبيه
 * الثاني لن يتكرر لأن dedupeKey مطابق — احتمال ضئيل عملياً، ومقبول كنفس
 * نوع المقايضة المعمارية بالضبط المستخدمة بالنسخة اليومية (dedupeKey بتاريخ
 * اليوم فقط بصرف النظر عن المنتجات المتأثرة).
 */
export const onProductStockChanged = onDocumentUpdated(
  "products/{productId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const beforeStock = typeof before.stock === "number" ? before.stock : 0;
    const afterStock = typeof after.stock === "number" ? after.stock : 0;
    if (beforeStock === afterStock) return; // لا تغيّر فعلي بالمخزون (تعديل سعر/اسم فقط مثلاً) — تجاهل

    if (!after.isActive) return; // منتج غير نشط أصلاً — لا يظهر للعملاء، لا داعي لتنبيه عنه

    const settingsDoc = await db.collection("settings").doc("store").get();
    const threshold = settingsDoc.exists ? (settingsDoc.data()?.lowStockThreshold || 5) : 5;

    const wasAlreadyLow = Boolean(before.isActive) && beforeStock <= threshold;
    const isLowNow = afterStock <= threshold;
    if (!isLowNow || wasAlreadyLow) return; // إما لسه فوق الحد، أو كان منخفضاً بالفعل قبل هذه الكتابة (لا عبور جديد)

    const productId = event.params.productId as string;
    const name = (after.name as string) ?? "منتج";

    await createAdminAlert({
      dedupeKey: `low_stock_cross:${productId}:${beforeStock}:${afterStock}`,
      type: "lowStock",
      requiredPermission: "products",
      title: "منتج وصل لحد المخزون المنخفض",
      body: `${name} — الكمية المتبقية: ${afterStock}`,
      actionRoute: "/products",
    });
  }
);
