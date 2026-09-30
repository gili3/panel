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
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

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
    await setDoc(doc(db, "users/adm"), { role: "admin", adminPermissions: ["products", "categories", "banners", "brands", "notifications"] });
    // أدمن حقيقي (role: admin) لكن بصلاحية واحدة محصورة لا علاقة لها بالصور — يحاكي
    // موظف دعم بصلاحية "رسائل التواصل" فقط يملك بيانات اعتماد أدمن صالحة.
    await setDoc(doc(db, "users/adm-limited"), { role: "admin", adminPermissions: ["contactMessages"] });
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

// ─────────────────────────────────────────────────────────────────────────
// الطلب والمخزون والعدّاد والكوبون تُكتب حصراً من Cloud Function `placeOrder` (Admin SDK) —
// منطق التسعير/المخزون/الكوبون نفسه مغطّى باختبارات وحدة (server/*.test.ts) واختبار التطابق
// (tests/functions/order-pricing-parity.test.ts). هنا نتأكد أن العميل لا يستطيع تجاوزه أبداً.
// ─────────────────────────────────────────────────────────────────────────
describe("الكتابة المباشرة من العميل مقفلة (إنشاء الطلب/المخزون/العدّاد/الكوبون)", () => {
  it("حتى طلب سليم تماماً من حساب مؤكَّد يُرفض — الإنشاء عبر placeOrder فقط", async () => {
    const db = verified("u1").firestore();
    await assertFails(setDoc(doc(db, "orders/ok1"), validOrder()));
  });

  it("لا استنزاف مخزون: أي إنقاص/تعديل على المنتجات مرفوض", async () => {
    const db = verified("u1").firestore();
    await assertFails(updateDoc(doc(db, "products/p1"), { stock: 49 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { stock: 0 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { price: 1 }));
    await assertFails(updateDoc(doc(db, "products/p1"), { isActive: false }));
  });

  it("العدّاد داخلي: لا قراءة ولا إنشاء ولا زيادة", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "counters/orders"), { current: 11001000 });
    });
    const db = verified("u1").firestore();
    await assertFails(getDoc(doc(db, "counters/orders")));
    await assertFails(updateDoc(doc(db, "counters/orders"), { current: 11001001 }));
    await assertFails(setDoc(doc(db, "counters/other"), { current: 11001000 }));
  });

  it("لا حرق كوبون: usageCount وusedBy لا يُكتبان من العميل، منفردين أو بدفعة واحدة", async () => {
    const db = verified("u1").firestore();
    await assertFails(updateDoc(doc(db, "coupons/SAVE10"), { usageCount: 1 }));
    await assertFails(updateDoc(doc(db, "coupons/SAVE10"), { discountValue: 100 }));
    await assertFails(setDoc(doc(db, "coupons/SAVE10/usedBy/u1"), { usedAt: new Date() }));
    const batch = writeBatch(db);
    batch.update(doc(db, "coupons/SAVE10"), { usageCount: 1 });
    batch.set(doc(db, "coupons/SAVE10/usedBy/u1"), { usedAt: new Date() });
    await assertFails(batch.commit());
  });

  it("رسائل التواصل: لا كتابة مباشرة (حتى للزائر) — الإرسال عبر submitContactMessage", async () => {
    const msg = { name: "س", email: "a@b.co", subject: "", message: "مرحبا", userId: null, status: "new", createdAt: new Date() };
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "contactMessages/m1"), msg));
    await assertFails(setDoc(doc(verified("u1").firestore(), "contactMessages/m2"), { ...msg, userId: "u1" }));
    await assertFails(getDoc(doc(verified("u1").firestore(), "contactMessages/m2")));
  });
});

describe("القراءات الشرعية ما زالت تعمل", () => {
  it("قراءة كوبون بمعرّفه للمعاينة، ومنع جلب القائمة كاملة (لا تعداد للأكواد)", async () => {
    const db = verified("u1").firestore();
    await assertSucceeds(getDoc(doc(db, "coupons/SAVE10")));
    await assertFails(getDocs(collection(db, "coupons")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "coupons/SAVE10")));
  });

  it("العميل يقرأ سجل استخدام كوبونه هو فقط وطلباته هو فقط", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, "coupons/SAVE10/usedBy/u1"), { usedAt: new Date() });
      await setDoc(doc(adminDb, "orders/o-u1"), { userId: "u1", status: "under_review", total: 130 });
    });
    const db = verified("u1").firestore();
    await assertSucceeds(getDoc(doc(db, "coupons/SAVE10/usedBy/u1")));
    await assertFails(getDoc(doc(db, "coupons/SAVE10/usedBy/u2")));
    await assertSucceeds(getDoc(doc(db, "orders/o-u1")));
    await assertFails(getDoc(doc(db, "orders/o-u2")));
  });

  it("الحساب غير المؤكَّد يقرأ ملفه ويدير سلته (لا تُحجب وظائف غير الشراء)", async () => {
    const db = unverified("u1").firestore();
    await assertSucceeds(getDoc(doc(db, "users/u1")));
    await assertSucceeds(setDoc(doc(db, "users/u1/cart/p1"), { quantity: 1 }));
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
  it("العميل العادي لا يرفع لمجلدات المتجر، والأدمن بصلاحية products يرفع لها", async () => {
    const st = env.authenticatedContext("u1").storage();
    await assertFails(uploadBytes(ref(st, "products/hack.png"), png, { contentType: "image/png" }));
    const adm = env.authenticatedContext("adm").storage();
    await assertSucceeds(uploadBytes(ref(adm, "products/ok.png"), png, { contentType: "image/png" }));
  });
  it("أدمن حقيقي بصلاحية محصورة (لا 'products' ولا 'banners') لا يرفع ولا يحذف صور منتجات أو بانرات — الصلاحية العامة role:admin لا تكفي وحدها", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "banners/existing.png"), png, { contentType: "image/png" });
    });
    const limited = env.authenticatedContext("adm-limited").storage();
    await assertFails(uploadBytes(ref(limited, "products/x.png"), png, { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(limited, "banners/existing.png"), png, { contentType: "image/png" })); // استبدال أيضاً ممنوع
    await assertFails(deleteObject(ref(limited, "banners/existing.png")));
  });
  it("أدمن بصلاحية 'banners' فقط يرفع لمجلد البانرات لكن ليس لمجلد المنتجات", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/adm-banners"), { role: "admin", adminPermissions: ["banners"] });
    });
    const bannersAdmin = env.authenticatedContext("adm-banners").storage();
    await assertSucceeds(uploadBytes(ref(bannersAdmin, "banners/ok.png"), png, { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(bannersAdmin, "products/nope.png"), png, { contentType: "image/png" }));
  });
});
