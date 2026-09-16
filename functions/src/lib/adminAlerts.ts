import * as crypto from "crypto";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, messaging } from "./admin";

// ⚠️ حزمة functions/ منفصلة تماماً عن حزمة اللوحة (rootDir: "src" بـ
// tsconfig هنا) ولا تستطيع استيراد shared/adminPermissions.ts مباشرة. هذا
// النوع نسخة نصية موازية له — أي صلاحية جديدة تُضاف بـshared/adminPermissions.ts
// ويُراد استخدامها كـrequiredPermission هنا يجب إضافتها هنا يدوياً أيضاً
// (على الأقل حتى يُستخرَج adminPermissions.ts لباكدج مشترك بين server/functions).
type AdminPermission =
  | "statistics"
  | "products"
  | "orders"
  | "categories"
  | "banners"
  | "brands"
  | "coupons"
  | "settings"
  | "users"
  | "notifications"
  | "contactMessages";

/**
 * ELEVEN STORE — تنبيهات لوحة التحكم (الجرس بالهيدر)
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ هذا نظام منفصل تماماً عن users/{uid}/notifications (نواة الإشعارات
 * v2 في notifications.ts). ذلك النظام مخصص للعميل النهائي (تحديث حالة
 * الطلب، عروض، ترحيب...) — كان "طلب جديد" لصاحب المتجر يُكتب سابقاً في
 * *نفس* تلك القائمة تحت uid الأدمن نفسه، فإن كان هذا الأدمن نفسه عميلاً
 * حقيقياً بالمتجر تختلط تنبيهاته الشخصية (كعميل) بتنبيهات إدارة اللوحة
 * بنفس القائمة ونفس عدّاد notifUnreadCount — وأيضاً كل أدمن جديد يُضاف
 * يعني مستنداً منفصلاً لكل أدمن لكل حدث (fan-out).
 *
 * هنا: مستند تنبيه *واحد* لكل حدث بمجموعة top-level مستقلة (adminAlerts)،
 * يحمل الصلاحية المطلوبة لرؤيته (requiredPermission)، ويبقى دائماً مصدر
 * الحقيقة الكامل (Admin-SDK-only، بلا حد قراءة) لهذا الحدث.
 *
 * ✅ v2: بالإضافة لذلك، فور إنشاء المستند نفان-آوته أيضاً (fanOutAlertToAdmins
 * أدناه) لمستند مستقل تحت كل أدمن معنيّ حالياً بهذه الصلاحية
 * (users/{uid}/adminAlerts/{alertId}) — هذا ما يشترك به العميل مباشرة
 * (onSnapshot، راجع client/src/hooks/useAdminAlerts.ts) بدل قراءة هذا
 * المستند العلوي عبر tRPC + polling كما كان سابقاً. أدمن يُمنح الصلاحية
 * *لاحقاً* لا يرى تلقائياً تنبيهات هذه المجموعة العلوية القديمة (الفلترة
 * الآن وقت الكتابة لا وقت القراءة) — لهذا server/admin-alerts-backfill.ts
 * ينسخ له صراحةً آخر التنبيهات المطابقة فور منحه الصلاحية.
 *
 * نفس قرار التعريف الحتمي (sha1 dedupeKey) من notifications.ts — استدعاء
 * متكرر لنفس الحدث (إعادة تنفيذ Cloud Function) يكتب نفس المستند فلا
 * ينتج تنبيهاً مكرراً بالجرس.
 */

// ✅ إضافة "lowStock": تنبيه يومي لمنتجات وصلت لحد المخزون المنخفض —
// راجع scheduled/lowStockAlert.ts. لا entityId واحد له (تنبيه مجمَّع
// لعدة منتجات معاً)، لذلك غير مضاف إلى نوع entityType تحته.
export type AdminAlertType = "order" | "contactMessage" | "lowStock";

export interface CreateAdminAlertInput {
  dedupeKey: string;
  type: AdminAlertType;
  requiredPermission: AdminPermission;
  title: string;
  body: string;
  actionRoute?: string;
  entityType?: "order" | "contactMessage" | null;
  entityId?: string | null;
  /**
   * ✅ جديد: هل يُرسَل Push فعلي لأجهزة الأدمنز المعنيين فور إنشاء هذا
   * التنبيه؟ افتراضياً true. استثناء وحيد حالياً: orderTriggers.ts يمرر
   * false هنا صراحة، لأنه يستدعي بالفعل notify() شخصياً لكل أدمن بصلاحية
   * "orders" فوق هذا الاستدعاء مباشرة (نفس السطر أعلاه) — وذلك الاستدعاء
   * يرسل Push حقيقياً أصلاً عبر قناة إشعارات العميل الشخصية. لو تركنا
   * الافتراضي هنا (true) بلا استثناء، كل أدمن كان سيتلقى Push مزدوجاً
   * (مرة من notify الشخصي، ومرة من هذا الجرس) لنفس حدث "طلب جديد" بالضبط.
   */
  sendPush?: boolean;
}

function alertIdFromDedupeKey(dedupeKey: string): string {
  return crypto.createHash("sha1").update(dedupeKey).digest("hex").slice(0, 32);
}

// نفس أكواد أخطاء FCM الدائمة المستخدمة بـlib/notifications.ts — توكن تالف
// نهائياً (تطبيق أُزيل، متصفح مسح بيانات الموقع...) لا عابر.
const PERMANENT_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

// نفس منطق resolveAbsoluteLink بـlib/notifications.ts — SITE_BASE_URL هنا
// يجب أن يشير لدومين لوحة التحكم تحديداً (وليس دومين المتجر)، لأن الجرس
// وكل روابط actionRoute الخاصة به مخصّصة لصفحات اللوحة (/orders، /contact-messages...)
// لا صفحات الموقع العام.
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "").replace(/\/$/, "");

function resolveAbsoluteLink(actionRoute?: string): string {
  const path = actionRoute && actionRoute.startsWith("/") ? actionRoute : "/";
  return SITE_BASE_URL ? `${SITE_BASE_URL}${path}` : path;
}

/**
 * يرجع uids كل الأدمنز الذين يجب إعلامهم بتنبيه يتطلّب هذه الصلاحية —
 * صاحب المتجر (OWNER_OPEN_ID) دائماً بغض النظر عمّا هو مخزَّن بمستنده
 * (نفس منطق buildUser.ts بالسيرفر، مكرَّر هنا يدوياً لنفس سبب AdminPermission
 * أعلاه: حزمة functions/ منفصلة ولا تستطيع استيراد كود السيرفر مباشرة)،
 * زائد أي أدمن آخر (role == "admin") يملك هذه الصلاحية تحديداً بمصفوفة
 * adminPermissions — نفس نمط getOrderAdminUidsToNotify بـorderTriggers.ts.
 */
async function getAdminUidsForPermission(permission: AdminPermission): Promise<string[]> {
  const uids = new Set<string>();
  const ownerUid = process.env.OWNER_OPEN_ID || "";
  if (ownerUid) uids.add(ownerUid);

  try {
    const snapshot = await db.collection("users").where("role", "==", "admin").get();
    for (const doc of snapshot.docs) {
      const permissions: unknown = doc.data().adminPermissions;
      if (Array.isArray(permissions) && permissions.includes(permission)) {
        uids.add(doc.id);
      }
    }
  } catch (error) {
    console.error("[AdminAlerts] فشل جلب قائمة الأدمنز من Firestore:", error);
  }

  return [...uids];
}

/**
 * يرسل Push فعلياً لكل أجهزة الأدمنز المعنيين — نفس نمط "data-only" حصراً
 * المستخدم بـlib/notifications.ts (بلا أي حقل notification أعلى المستوى)،
 * لنفس السبب بالضبط: ضمان استدعاء onMessageReceived/service worker دائماً
 * بدل مسار عرض تلقائي غير موثوق بالنظام. alertId (معرّف حتمي sha1) يُمرَّر
 * كـnotificationId ليُستخدم كـtag ثابت بالعميل، فإعادة تسليم نفس الحدث من
 * FCM (نادر لكن وارد) تستبدل نفس الإشعار المعروض بدل تكراره.
 *
 * لا يرمي أبداً — فشل الـPush لا يجب أن يُسقط إنشاء سجل التنبيه نفسه (الذي
 * يبقى مرئياً بالجرس عبر polling حتى لو تعذّر تسليم الـPush الفوري).
 */
async function pushToAdmins(
  uids: string[],
  alertId: string,
  title: string,
  body: string,
  actionRoute?: string
): Promise<void> {
  if (uids.length === 0) return;

  // نجمع كل التوكنات من كل الأدمنز المعنيين برسالة multicast واحدة، مع
  // الاحتفاظ بخريطة توكن→صاحبه لتنظيف التوكنات الميتة لاحقاً من مستند
  // كل أدمن تحديداً (وليس حذفها من مكان عشوائي).
  const tokensByUid = new Map<string, string[]>();
  const allTokens: string[] = [];

  await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await db.collection("users").doc(uid).get();
        const tokens: string[] = snap.data()?.fcmTokens || [];
        if (tokens.length > 0) {
          tokensByUid.set(uid, tokens);
          allTokens.push(...tokens);
        }
      } catch (error) {
        console.error(`[AdminAlerts] فشل جلب توكنات الأدمن ${uid}:`, error);
      }
    })
  );

  if (allTokens.length === 0) return;

  try {
    const response = await messaging.sendEachForMulticast({
      data: {
        notificationId: alertId,
        title,
        body,
        type: "adminAlert",
        actionRoute: actionRoute || "",
      },
      tokens: allTokens,
      android: { priority: "high" as const },
      webpush: {
        headers: { Urgency: "high" },
        fcmOptions: { link: resolveAbsoluteLink(actionRoute) },
      },
    });

    if (response.failureCount > 0) {
      const deadTokens = new Set<string>();
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code && PERMANENT_TOKEN_ERROR_CODES.has(resp.error.code)) {
          deadTokens.add(allTokens[idx]);
        }
      });
      if (deadTokens.size > 0) {
        // نحذف كل توكن ميت من مستند صاحبه تحديداً — لا يوجد أكثر من أدمن
        // واحد عملياً يملك نفس التوكن، لكن الفحص per-uid أسلم من افتراض ذلك.
        await Promise.all(
          [...tokensByUid.entries()].map(async ([uid, tokens]) => {
            const dead = tokens.filter((t) => deadTokens.has(t));
            if (dead.length === 0) return;
            await db.collection("users").doc(uid).update({
              fcmTokens: FieldValue.arrayRemove(...dead),
            });
          })
        );
      }
    }
  } catch (error) {
    console.error("[AdminAlerts] تعذّر إرسال الـPush لأدمنز اللوحة:", error);
  }
}

/**
 * ✅ v2 — فان-آوت للقراءة الحية: يكتب نسخة من التنبيه بمستند مستقل تحت
 * كل أدمن مستهدَف (users/{uid}/adminAlerts/{alertId}) بدل الاعتماد على
 * قراءة مستند adminAlerts العلوي مباشرة (كان يتطلب polling عبر tRPC لأن
 * قواعد الأمان لا يمكنها تفويض قائمة بحسب صلاحية متغيّرة بأمان تام).
 * الآن كل أدمن يشترك مباشرة (onSnapshot) بمجموعته الفرعية الخاصة به —
 * نفس فكرة users/{uid}/notifications تماماً لكن لتنبيهات اللوحة.
 * alertId نفسه (sha1 حتمي) يُستخدم كمعرّف المستند هنا أيضاً، فإعادة تنفيذ
 * نفس الحدث (retry) يستبدل نفس النسخة لدى كل أدمن بدل تكرارها.
 * حقل alertId مكرَّر داخل المستند (رغم كونه أيضاً id المستند) خصيصاً
 * ليتيح استعلام collectionGroup به لاحقاً بـadminAlertsCleanup.ts (لا يمكن
 * الاستعلام بسهولة بـFieldPath.documentId عبر آباء مختلفين بـcollectionGroup).
 */
async function fanOutAlertToAdmins(
  uids: string[],
  alertId: string,
  input: CreateAdminAlertInput
): Promise<void> {
  if (uids.length === 0) return;
  const batch = db.batch();
  for (const uid of uids) {
    const ref = db.collection("users").doc(uid).collection("adminAlerts").doc(alertId);
    batch.set(ref, {
      alertId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionRoute: input.actionRoute ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      isRead: false,
      createdAt: Timestamp.now(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    console.error("[AdminAlerts] تعذّر فان-آوت التنبيه لمستندات الأدمنز:", error);
  }
}

/** ينشئ تنبيه لوحة تحكم idempotent، يفان-آوته حياً لكل أدمن معني، ويرسل Push فعلياً لأجهزتهم (ما لم يُطلب تخطيه صراحة). لا يرمي أبداً — فشل التنبيه لا يجب أن يُسقط الحدث الأصلي (إنشاء الطلب/الرسالة). */
export async function createAdminAlert(input: CreateAdminAlertInput): Promise<void> {
  try {
    const id = alertIdFromDedupeKey(input.dedupeKey);
    const ref = db.collection("adminAlerts").doc(id);

    const created = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return false; // نفس الحدث سبق تسجيله — لا شيء نفعله، ولا Push جديد.
      tx.set(ref, {
        dedupeKey: input.dedupeKey,
        type: input.type,
        requiredPermission: input.requiredPermission,
        title: input.title,
        body: input.body,
        actionRoute: input.actionRoute ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        readBy: [] as string[],
        createdAt: Timestamp.now(),
      });
      return true;
    });

    // فان-آوت + Push فقط لتنبيه جُدَّ إنشاؤه فعلاً الآن — إعادة تنفيذ نفس
    // الحدث (retry من Cloud Functions) لا يجب أن تُنتج تنبيهاً ولا Push
    // مزعجَين ثانيةً لتنبيه موجود أصلاً، بنفس منطق notify() بالضبط.
    if (created) {
      const uids = await getAdminUidsForPermission(input.requiredPermission);
      await fanOutAlertToAdmins(uids, id, input);
      if (input.sendPush !== false) {
        await pushToAdmins(uids, id, input.title, input.body, input.actionRoute);
      }
    }
  } catch (error) {
    console.error("[AdminAlerts] تعذّر إنشاء تنبيه اللوحة:", error);
  }
}
