import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../lib/admin";
import { createAdminAlert } from "../lib/adminAlerts";

/**
 * ✅ جديد: getAdminStats (server/firestore-router.ts) يحسب lowStockProducts
 * أصلاً وبكفاءة (استعلام مباشر isActive+stock)، لكن محدش يشوف النتيجة غير
 * لو فتح أدمن صفحة "نظرة عامة" بنفسه — منتج ممكن يفضل تحت الحد الأدنى
 * أيام كاملة بلا ما حد ينتبه. هنا نفس المنطق، بس كتنبيه يومي استباقي بالجرس
 * بدل الاكتشاف بالصدفة.
 *
 * ⚠️ صلاحية "products" مُختارة هنا (مين بيدير المنتجات هو المعني بالتخزين)
 * — لو المقصود فعلاً "statistics" بدلاً منها (نفس صلاحية getAdminStats)،
 * هذا السطر الوحيد المطلوب تغييره.
 *
 * dedupeKey مبني على تاريخ اليوم فقط (بلا معرّف منتج) — أي تنبيه واحد
 * مجمَّع باليوم بصرف النظر عن عدد المنتجات المتأثرة، يتكرر يومياً تلقائياً
 * طالما المشكلة لم تُحل (يوم جديد = dedupeKey جديد = تنبيه جديد)، فهو
 * تذكير يومي فعلي لا مرة واحدة فقط.
 */
export const checkLowStock = onSchedule(
  { schedule: "every day 09:00", timeZone: "Africa/Cairo" },
  async () => {
    const settingsDoc = await db.collection("settings").doc("store").get();
    const threshold = settingsDoc.exists ? (settingsDoc.data()?.lowStockThreshold || 5) : 5;

    const snapshot = await db
      .collection("products")
      .where("isActive", "==", true)
      .where("stock", "<=", threshold)
      .orderBy("stock", "asc")
      .limit(50)
      .get();

    if (snapshot.empty) {
      console.log("[checkLowStock] لا يوجد منتجات تحت حد المخزون المنخفض اليوم");
      return;
    }

    const products = snapshot.docs.map((doc) => ({
      name: (doc.data().name as string) ?? "منتج",
      stock: (doc.data().stock as number) ?? 0,
    }));

    const preview = products
      .slice(0, 3)
      .map((p) => `${p.name} (${p.stock})`)
      .join("، ");
    const remaining = products.length - 3;
    const body = remaining > 0 ? `${preview} +${remaining} أخرى` : preview;

    const todayKey = new Date().toISOString().slice(0, 10);

    await createAdminAlert({
      dedupeKey: `low_stock:${todayKey}`,
      type: "lowStock",
      requiredPermission: "products",
      title: `${products.length} منتج وصل لحد المخزون المنخفض`,
      body,
      actionRoute: "/products",
    });
  }
);
