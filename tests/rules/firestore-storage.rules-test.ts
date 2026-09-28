// ELEVEN STORE — اختبارات أمان قواعد Firestore وStorage (تعمل على المحاكي)
// ─────────────────────────────────────────────────────────────────────────
// تشغيل:  pnpm test:rules   (يشغّل المحاكي ثم vitest تلقائياً — يتطلب Java + firebase-tools)
// كل اختبار يحاكي مهاجماً حقيقياً (حساب عادي بمفاتيح Firebase العامة يكتب مباشرة للقاعدة)،
// ويتوقع الرفض. اختبارات "يجب أن ينجح" تضمن أن التشديد لم يكسر المسارات الشرعية.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

let env: RulesTestEnvironment;

// حساب بريده مؤكَّد (الحالة الطبيعية لأي مستخدم فعلي بعد إلزام التأكيد)
const verified = (uid: string) => env.authenticatedContext(uid, { email_verified: true });
const unverified = (uid: string) => env.authenticatedContext(uid, { email_verified: false });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-eleven",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});
afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/u1"), { name: "عميل 1" });
    await setDoc(doc(db, "users/u2"), { name: "عميل 2" });
    await setDoc(doc(db, "users/adm"), { role: "admin" });
    await setDoc(doc(db, "products/p1"), { name: "منتج", price: 100, stock: 50, isActive: true });
    await setDoc(doc(db, "settings/store"), { shippingCost: 30, freeShippingThreshold: 0 });
    await setDoc(doc(db, "coupons/SAVE10"), {
      isActive: true, discountType: "percentage", discountValue: 10,
      minOrderAmount: 0, usageLimit: 100, usageCount: 0,
    });
    await setDoc(doc(db, "orders/o-u2"), { userId: "u2", status: "under_review", total: 130 });
  });
});

const validOrder = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  status: "under_review",
  items: [{ productId: "p1", name: "منتج", quantity: 1, price: 100 }],
  subtotal: 100, discount: 0, shippingCost: 30, total: 130,
  ...over,
});

describe("الوصول غير المصرّح به", () => {
  it("زائر بلا تسجيل لا يقرأ/يكتب المستخدمين أو الطلبات، ويقرأ المنتجات فقط", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/u1")));
    await assertFails(getDoc(doc(db, "orders/o-u2")));
    await assertFails(setDoc(doc(db, "orders/x"), validOrder()));
    await assertFails(updateDoc(doc(db, "products/p1"), { price: 1 }));
    await assertSucceeds(getDoc(doc(db, "products/p1")));
  });

  it("عميل لا يقرأ طلب عميل آخر ولا ملفه الشخصي، ويقرأ طلبه هو", async () => {
    const db = verified("u1").firestore();
    await assertFails(getDoc(doc(db, "orders/o-u2")));
    await assertFails(getDoc(doc(db, "users/u2")));
    await assertSucceeds(getDoc(doc(db, "users/u1")));
  });

  it("لا تصعيد صلاحيات: لا يستطيع أي مستخدم ضبط role أو adminPermissions لنفسه", async () => {
    const db = verified("u1").firestore();
    await assertFails(updateDoc(doc(db, "users/u1"), { role: "admin" }));
    await assertFails(updateDoc(doc(db, "users/u1"), { adminPermissions: ["orders"] }));
    await assertFails(setDoc(doc(db, "users/u3-new"), { role: "admin" })); // uid مختلف عن الجلسة
    const db3 = verified("u3-new").firestore();
    await assertFails(setDoc(doc(db3, "users/u3-new"), { role: "admin", name: "x" }));
  });

  it("الطلبات لا تُحدَّث ولا تُحذف من العميل أبداً", async () => {
    const db = verified("u2").firestore();
    await assertFails(updateDoc(doc(db, "orders/o-u2"), { status: "delivered" }));
    await assertFails(updateDoc(doc(db, "orders/o-u2"), { total: 1 }));
  });
});

describe("التلاعب بالأسعار والكميات والشحن (إنشاء الطلب)", () => {
  it("طلب سليم يُقبل", async () => {
    const db = verified("u1").firestore();
    await assertSucceeds(setDoc(doc(db, "orders/ok1"), validOrder()));
  });
  it("سعر عنصر مخفَّض يُرفض", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/bad1"), validOrder({
      items: [{ productId: "p1", name: "منتج", quantity: 1, price: 1 }], subtotal: 1, total: 31,
    })));
  });
  it("مجموع فرعي/إجمالي غير متسق يُرفض", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/bad2"), validOrder({ subtotal: 10, total: 40 })));
    await assertFails(setDoc(doc(db, "orders/bad3"), validOrder({ total: 1 })));
  });
  it("شحن مجاني مزوَّر يُرفض", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/bad4"), validOrder({ shippingCost: 0, total: 100 })));
  });
  it("كمية كسرية أو صفر أو سالبة تُرفض", async () => {
    const db = verified("u1").firestore();
    for (const [i, q] of [0.001, 0, -2].entries()) {
      await assertFails(setDoc(doc(db, `orders/badq${i}`), validOrder({
        items: [{ productId: "p1", name: "منتج", quantity: q, price: 100 }],
        subtotal: 100 * q, total: 100 * q + 30,
      })));
    }
  });
  it("حالة ابتدائية غير under_review أو انتحال userId يُرفضان", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/bad5"), validOrder({ status: "delivered" })));
    await assertFails(setDoc(doc(db, "orders/bad6"), validOrder({ userId: "u2" })));
  });
  it("خصم بلا كوبون يُرفض", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/bad7"), validOrder({ discount: 50, total: 80 })));
  });
});

describe("حسابات غير مؤكَّدة البريد", () => {
  it("لا تنشئ طلباً ولا تنقص مخزوناً ولا تزيد العدّاد أو استخدام كوبون", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "counters/orders"), { current: 11001000 });
    });
    const db = unverified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/nv1"), validOrder()));
    await assertFails(updateDoc(doc(db, "products/p1"), { stock: 49 }));
    await assertFails(updateDoc(doc(db, "counters/orders"), { current: 11001001 }));
    const batch = writeBatch(db);
    batch.update(doc(db, "coupons/SAVE10"), { usageCount: 1 });
    batch.set(doc(db, "coupons/SAVE10/usedBy/u1"), { usedAt: new Date() });
    await assertFails(batch.commit());
  });
  it("لكنها تقرأ ملفها وتدير سلتها (لا تُحجب وظائف غير الشراء)", async () => {
    const db = unverified("u1").firestore();
    await assertSucceeds(getDoc(doc(db, "users/u1")));
    await assertSucceeds(setDoc(doc(db, "users/u1/cart/p1"), { quantity: 1 }));
  });
});

describe("الكوبونات", () => {
  it("قراءة كوبون بمعرّفه مسموحة، وجلب القائمة كاملة ممنوع (لا تعداد للأكواد)", async () => {
    const db = verified("u1").firestore();
    await assertSucceeds(getDoc(doc(db, "coupons/SAVE10")));
    await assertFails(getDocs(collection(db, "coupons")));
  });
  it("لا استنزاف: زيادة usageCount منفردة بلا سجل usedBy تُرفض (حتى مكرَّرة)", async () => {
    const db = verified("u1").firestore();
    await assertFails(updateDoc(doc(db, "coupons/SAVE10"), { usageCount: 1 }));
  });
  it("الاستخدام الشرعي: usageCount+1 مع إنشاء usedBy بنفس الدفعة يُقبل", async () => {
    const db = verified("u1").firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, "coupons/SAVE10"), { usageCount: 1 });
    batch.set(doc(db, "coupons/SAVE10/usedBy/u1"), { usedAt: new Date() });
    await assertSucceeds(batch.commit());
  });
  it("لا يمكن تعديل قيمة الكوبون أو تفعيله", async () => {
    const db = verified("u1").firestore();
    await assertFails(updateDoc(doc(db, "coupons/SAVE10"), { discountValue: 100 }));
  });
});

describe("المخزون والمنتجات", () => {
  it("إنقاص المخزون ضمن الحد مسموح، لكن الزيادة أو القفزة الكبيرة أو تغيير السعر مرفوضة", async () => {
    const db = verified("u1").firestore();
    await assertSucceeds(updateDoc(doc(db, "products/p1"), { stock: 45 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { stock: 999 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { stock: 0 })); // 45 → 0 = أكثر من 10
    await assertFails(updateDoc(doc(db, "products/p1"), { price: 1 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { isActive: false }));
  });
});

describe("Storage: الإيصالات والصور", () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  it("العميل يرفع إيصاله في مجلده فقط وبنوع صورة", async () => {
    const st = env.authenticatedContext("u1").storage();
    await assertSucceeds(uploadBytes(ref(st, "receipts/u1/a.jpg"), png, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(st, "receipts/u2/a.jpg"), png, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(st, "receipts/u1/b.html"), png, { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(st, "receipts/u1/c.svg"), png, { contentType: "image/svg+xml" }));
  });
  it("لا قراءة لإيصال مستخدم آخر، ولا استبدال أو حذف لإيصال مرفوع", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "receipts/u2/x.jpg"), png, { contentType: "image/jpeg" });
    });
    const st1 = env.authenticatedContext("u1").storage();
    await assertFails(getBytes(ref(st1, "receipts/u2/x.jpg")));
    const st2 = env.authenticatedContext("u2").storage();
    await assertSucceeds(getBytes(ref(st2, "receipts/u2/x.jpg")));
    await assertFails(uploadBytes(ref(st2, "receipts/u2/x.jpg"), png, { contentType: "image/jpeg" }));
  });
  it("العميل العادي لا يرفع لمجلدات المتجر، والأدمن يرفع", async () => {
    const st = env.authenticatedContext("u1").storage();
    await assertFails(uploadBytes(ref(st, "products/hack.png"), png, { contentType: "image/png" }));
    const adm = env.authenticatedContext("adm").storage();
    await assertSucceeds(uploadBytes(ref(adm, "products/ok.png"), png, { contentType: "image/png" }));
  });
});
