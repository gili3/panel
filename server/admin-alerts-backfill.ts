// backfill فان-آوت تنبيهات اللوحة عند منح أدمن صلاحية جديدة.
//
// ✅ لماذا هذا الملف موجود أصلاً: بعد نقل الجرس لنظام الفان-آوت (راجع
// functions/src/lib/adminAlerts.ts)، أي تنبيه يُكتب فقط لمن كانت صلاحيته
// تشمل requiredPermission *وقت إنشاء التنبيه*. أدمن يُمنح صلاحية جديدة لاحقاً
// (setAdminStatus / updateAdminPermissions أدناه) لن يرى تلقائياً أي تنبيه
// قديم يخص تلك الصلاحية بدون هذا الاستدعاء الصريح — يقرأ آخر تنبيهات
// المستند العلوي (adminAlerts، الذي يبقى Admin-SDK-only دائماً ومصدر الحقيقة
// الكامل بلا حد قراءة) المطابقة للصلاحيات المضافة تحديداً، وينسخها لمجموعة
// هذا الأدمن الفرعية (users/{uid}/adminAlerts) كأنها وصلت الآن لأول مرة.
//
// idempotent: يستخدم نفس alertId كمعرّف مستند، فاستدعاء هذه الدالة أكثر من
// مرة (مثال: تعديل الصلاحيات مرتين متتاليتين) لا يكرر شيئاً، فقط يعيد كتابة
// نفس النسخة (isRead يُعاد إلى false في كل مرة — نعتبره مقبولاً: صلاحية
// جديدة = "تنبيهات جديدة عليك" فعلياً من منظور هذا الأدمن تحديداً).
import { adminDb } from "./firebase-admin";
import type { AdminPermission } from "@shared/adminPermissions";

// نفس حد الجرس بالضبط (KEEP_RECENT_COUNT بـadminAlertsCleanup.ts) — لا داعي
// لإغراق أدمن جديد الصلاحية بكل تاريخ المتجر، آخر الأحداث كافٍ تماماً.
const BACKFILL_LIMIT = 30;
// حد عملياً لعامل 'in' بـFirestore.
const IN_CHUNK_SIZE = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** ينسخ آخر تنبيهات المطابقة لهذه الصلاحيات المضافة حديثاً إلى مجموعة هذا الأدمن الفرعية. لا يرمي أبداً — فشل الـbackfill لا يجب أن يُسقط عملية منح الصلاحية نفسها. */
export async function backfillAdminAlertsForNewPermissions(
  uid: string,
  newlyGrantedPermissions: AdminPermission[]
): Promise<void> {
  if (newlyGrantedPermissions.length === 0) return;
  try {
    const matches: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const permsChunk of chunk(newlyGrantedPermissions, IN_CHUNK_SIZE)) {
      const snap = await adminDb
        .collection("adminAlerts")
        .where("requiredPermission", "in", permsChunk)
        .orderBy("createdAt", "desc")
        .limit(BACKFILL_LIMIT)
        .get();
      matches.push(...snap.docs);
    }
    if (matches.length === 0) return;

    // الأحدث فقط ضمن BACKFILL_LIMIT إجمالاً (وليس لكل صلاحية على حدة).
    matches.sort((a, b) => b.data().createdAt.toMillis() - a.data().createdAt.toMillis());
    const toCopy = matches.slice(0, BACKFILL_LIMIT);

    for (const docsChunk of chunk(toCopy, 400)) {
      const batch = adminDb.batch();
      for (const doc of docsChunk) {
        const data = doc.data();
        const ref = adminDb.collection("users").doc(uid).collection("adminAlerts").doc(doc.id);
        batch.set(ref, {
          alertId: doc.id,
          type: data.type,
          title: data.title,
          body: data.body,
          actionRoute: data.actionRoute ?? null,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          isRead: false,
          createdAt: data.createdAt,
        });
      }
      await batch.commit();
    }
  } catch (error) {
    console.error("[AdminAlertsBackfill] تعذّر نسخ التنبيهات القديمة للأدمن الجديد:", error);
  }
}
