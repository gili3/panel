import * as admin from "firebase-admin";
import * as functionsV1 from "firebase-functions/v1";
import { randomBytes } from "crypto";
import { db } from "../lib/admin";
import { checkRateLimitFirestore } from "../lib/rateLimit";
import { syncStockToAlgolia } from "../lib/algolia";
import {
  calculateOrderTotal,
  calculateShippingCost,
  calculateSubtotal,
  checkCoupon,
  isPointInAnyActiveZone,
  isValidReceiptUrl,
  mergeOrderItemQuantities,
  type CouponDoc,
  type DeliveryZone,
} from "../lib/orderPricing";

/**
 * إنشاء الطلب على السيرفر (Admin SDK) بدل كتابته مباشرة من عميل الأندرويد.
 *
 * لماذا؟ كانت قواعد Firestore تسمح لأي حساب موثَّق بإنقاص المخزون (حتى 10 وحدات بكل
 * كتابة) وزيادة العدّاد واستخدام الكوبون بلا طلب حقيقي، ولا تقارن كمية الطلب بالمخزون.
 * الآن كل هذه الكتابات تحدث حصراً داخل transaction واحدة هنا، والقواعد ترفضها من العميل.
 *
 * نفس منطق runOrderPricingTransaction بـserver/firestore-router.ts (المسار المستخدم بالموقع)،
 * مع كتابة مستند الطلب نفسه داخل نفس transaction فلا يمكن أن يُخصم المخزون/الكوبون بلا طلب.
 */

const MAX_LINES = 30;
const MAX_QTY = 999;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
// معرّف طلب يولّده العميل لكل محاولة شراء (UUID) — يصبح معرّف مستند الطلب نفسه، فإعادة إرسال
// نفس الطلب (انقطاع الشبكة بعد نجاحه على السيرفر) تُرجع الطلب الأول بدل إنشاء طلب مكرَّر.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const fail = (code: functionsV1.https.FunctionsErrorCode, message: string) =>
  new functionsV1.https.HttpsError(code, message);

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function reqString(v: unknown, max: number, label: string): string {
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
    throw fail("invalid-argument", `${label} غير صالح`);
  }
  return v.trim();
}

function optString(v: unknown, max: number, label: string): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || v.length > max) throw fail("invalid-argument", `${label} غير صالح`);
  return v.trim();
}

function reqCoord(v: unknown, limit: number, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > limit) {
    throw fail("invalid-argument", `${label} غير صالح`);
  }
  return v;
}

function parseItems(raw: unknown): Array<{ productId: string; quantity: number }> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) {
    throw fail("invalid-argument", "عناصر الطلب غير صالحة");
  }
  const lines = raw.map((entry) => {
    const e = asRecord(entry);
    const productId = reqString(e.productId, 128, "معرّف المنتج");
    const quantity = e.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw fail("invalid-argument", "الكمية غير صالحة");
    }
    return { productId, quantity };
  });
  return mergeOrderItemQuantities(lines);
}

function parseAddress(raw: unknown) {
  const a = asRecord(raw);
  const fullName = reqString(a.fullName ?? a.name, 100, "الاسم");
  return {
    id: optString(a.id, 128, "معرّف العنوان"),
    fullName,
    name: fullName,
    phone: reqString(a.phone, 30, "رقم الهاتف"),
    city: reqString(a.city, 60, "المدينة"),
    address: reqString(a.address, 300, "العنوان"),
    latitude: reqCoord(a.latitude ?? 0, 90, "خط العرض"),
    longitude: reqCoord(a.longitude ?? 0, 180, "خط الطول"),
    isDefault: a.isDefault === true,
  };
}

async function assertWithinDeliveryZone(lat: number, lng: number): Promise<void> {
  const doc = await db.collection("settings").doc("deliveryZones").get();
  const zonesRaw = doc.exists ? doc.data()?.zones : undefined;
  const zones: DeliveryZone[] = Array.isArray(zonesRaw) ? (zonesRaw as DeliveryZone[]) : [];
  if (!zones.some((z) => z.isActive)) return; // لا مناطق مفعّلة = الميزة معطّلة

  if (lat === 0 && lng === 0) {
    throw fail("invalid-argument", "يجب تحديد موقعك على الخريطة لإتمام الطلب — عنوانك خارج نطاق مناطق التوصيل المتاحة");
  }
  if (!isPointInAnyActiveZone({ lat, lng }, zones)) {
    throw fail("invalid-argument", "عذراً، موقع التوصيل الذي حدّدته يقع خارج مناطق التوصيل المعتمدة حالياً");
  }
}

function storageBucket(): string | undefined {
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || "{}").storageBucket || undefined;
  } catch {
    return undefined;
  }
}

// نسخة دافئة دائمة لتفادي تأخر أول طلب بعد خمول (البدء البارد). تكلفتها مستمرة، لذا الافتراضي 0؛
// فعّلها بوضع PLACE_ORDER_MIN_INSTANCES=1 في functions/.env (سر FUNCTIONS_ENV) قبل الإطلاق الفعلي.
const minInstances = Number(process.env.PLACE_ORDER_MIN_INSTANCES || 0);

export const placeOrder = functionsV1
  .runWith({ enforceAppCheck, ...(minInstances > 0 ? { minInstances } : {}) })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw fail("unauthenticated", "يجب تسجيل الدخول لإتمام الطلب");
    const uid = context.auth.uid;
    // التوكن قد يبقى email_verified=false بعد التأكيد حتى يتجدد (حتى ساعة) — نرجع لسجل Auth الحي.
    let verified = context.auth.token.email_verified === true;
    if (!verified) verified = (await admin.auth().getUser(uid)).emailVerified === true;
    if (!verified) throw fail("permission-denied", "يجب تأكيد بريدك الإلكتروني قبل إتمام الطلب");

    const input = asRecord(data);
    const items = parseItems(input.items);
    const shippingAddress = parseAddress(input.shippingAddress);
    const paymentMethod = reqString(input.paymentMethod, 50, "طريقة الدفع");
    const notes = optString(input.notes, 500, "الملاحظات");
    const requestId = optString(input.requestId, 64, "معرّف الطلب");
    if (requestId && !REQUEST_ID_RE.test(requestId)) throw fail("invalid-argument", "معرّف الطلب غير صالح");
    const couponCode = optString(input.couponCode, 50, "كود الخصم").toUpperCase() || undefined;

    const paymentReceipt = optString(input.paymentReceipt, 2048, "رابط الإيصال");
    if (paymentReceipt && !isValidReceiptUrl(paymentReceipt, uid, storageBucket())) {
      throw fail("invalid-argument", "رابط إيصال الدفع غير صالح");
    }

    if (!(await checkRateLimitFirestore(`place-order:${uid}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      throw fail("resource-exhausted", "طلبات كثيرة جداً، يرجى المحاولة لاحقاً");
    }

    await assertWithinDeliveryZone(shippingAddress.latitude, shippingAddress.longitude);

    const counterRef = db.collection("counters").doc("orders");
    const orderRef = requestId ? db.collection("orders").doc(requestId) : db.collection("orders").doc();
    const verificationToken = randomBytes(24).toString("base64url");

    const result = await db.runTransaction(async (tx) => {
      // ── كل القراءات أولاً (قيد Firestore transactions) ──
      // إعادة إرسال نفس requestId: الطلب أُنشئ سابقاً → نُرجعه كما هو بلا أي كتابة (idempotent).
      if (requestId) {
        const existing = await tx.get(orderRef);
        if (existing.exists) {
          if (existing.data()?.userId !== uid) throw fail("permission-denied", "معرّف الطلب مستخدم");
          return { orderNumber: String(existing.data()?.orderNumber ?? ""), stockUpdates: [] as Array<{ productId: string; stock: number }> };
        }
      }
      const productRefs = items.map((i) => db.collection("products").doc(i.productId));
      const productDocs = await Promise.all(productRefs.map((r) => tx.get(r)));
      const settingsDoc = await tx.get(db.collection("settings").doc("store"));
      const couponRef = couponCode ? db.collection("coupons").doc(couponCode) : null;
      const couponDoc = couponRef ? await tx.get(couponRef) : null;
      const usedByRef = couponCode
        ? db.collection("coupons").doc(couponCode).collection("usedBy").doc(uid)
        : null;
      const usedByDoc = usedByRef ? await tx.get(usedByRef) : null;
      const counterDoc = await tx.get(counterRef);

      if (usedByDoc?.exists) throw fail("failed-precondition", "لقد استخدمت هذا الكوبون من قبل");

      const authoritativeItems = productDocs.map((doc, idx) => {
        const item = items[idx];
        const p = doc.data();
        if (!doc.exists || !p || p.isActive === false) {
          throw fail("failed-precondition", "هذا المنتج لم يعد متوفراً");
        }
        const stock = typeof p.stock === "number" ? p.stock : 0;
        if (item.quantity > stock) {
          throw fail("failed-precondition", `${p.name}: الكمية المطلوبة غير متوفرة في المخزون`);
        }
        return {
          productId: item.productId,
          name: p.name as string,
          price: p.price as number,
          quantity: item.quantity,
          image: (p.images?.[0] || p.image || "") as string,
        };
      });

      const subtotal = calculateSubtotal(authoritativeItems);
      const shippingCost = calculateShippingCost(subtotal, settingsDoc.exists ? settingsDoc.data()! : {});

      let discountAmount = 0;
      let appliedCoupon: string | null = null;
      if (couponCode) {
        const coupon = couponDoc?.exists ? (couponDoc.data() as CouponDoc) : undefined;
        const check = checkCoupon(coupon, subtotal);
        if (!check.valid) throw fail("failed-precondition", check.message);
        discountAmount = check.discountAmount;
        appliedCoupon = couponCode;
      }

      // ── الكتابات ──
      const now = admin.firestore.Timestamp.now();
      productDocs.forEach((doc, idx) => {
        const stock = typeof doc.data()?.stock === "number" ? (doc.data()!.stock as number) : 0;
        tx.update(productRefs[idx], { stock: stock - items[idx].quantity, updatedAt: now });
      });

      if (appliedCoupon && couponRef && usedByRef) {
        tx.update(couponRef, { usageCount: (couponDoc!.data()!.usageCount ?? 0) + 1, updatedAt: now });
        tx.set(usedByRef, { userId: uid, usedAt: now });
      }

      const nextNumber = counterDoc.exists ? (counterDoc.data()?.current || 11001000) + 1 : 11001000;
      tx.set(counterRef, { current: nextNumber }, { merge: true });
      const orderNumber = String(nextNumber);

      tx.set(orderRef, {
        userId: uid,
        orderNumber,
        verificationToken,
        items: authoritativeItems,
        subtotal,
        discount: discountAmount,
        couponCode: appliedCoupon,
        shippingCost,
        total: calculateOrderTotal(subtotal, discountAmount, shippingCost),
        shippingAddress,
        paymentMethod,
        paymentReceipt,
        notes,
        status: "under_review",
        createdAt: now,
        updatedAt: now,
      });

      const stockUpdates = productDocs.map((doc, idx) => ({
        productId: items[idx].productId,
        stock: (typeof doc.data()?.stock === "number" ? (doc.data()!.stock as number) : 0) - items[idx].quantity,
      }));
      return { orderNumber, stockUpdates };
    });

    // بعد نجاح المعاملة: تحديث Algolia (أفضل جهد، بمهلة قصيرة) كي لا يظهر منتج نفد مخزونه ببحث عميل آخر.
    await syncStockToAlgolia(result.stockUpdates).catch(() => undefined);

    return { id: orderRef.id, orderNumber: result.orderNumber };
  });
