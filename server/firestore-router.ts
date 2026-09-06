import { adminDb, adminAuth } from "./firebase-admin";
import admin from "firebase-admin";
import { publicProcedure, router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "node:crypto";
import { checkCoupon, fetchCoupon, type CouponDoc } from "./coupon-service";
import { ENV } from "./_core/env";
import { checkRateLimit, clientKey } from "./_core/rateLimit";
import { syncProductToIndex, removeProductFromIndex, resyncProductsStock } from "./algolia-service";

// رسائل موحّدة تستخدم في كل عمليات السلة المرتبطة بالمخزون
const OUT_OF_STOCK_MSG = "الكمية المطلوبة غير متوفرة في المخزون";
const PRODUCT_NOT_FOUND_MSG = "هذا المنتج لم يعد متوفراً";

// ✅ إصلاح: verificationToken يُستخدم للتحقق العام من الطلب عبر QR (verifyOrder
// هو publicProcedure)، لذا يجب أن يكون غير قابل للتخمين. Math.random() ليس
// آمناً تعمياً (Non-CSPRNG)؛ نستخدم crypto.randomBytes بدلاً منه.
function generateVerificationToken(): string {
  return randomBytes(24).toString("base64url");
}

// ✅ إصلاح: بعض المستندات (خصوصاً ما يُكتب مباشرة من تطبيق الأندرويد عبر
// Client SDK) قد يكون فيها createdAt/updatedAt مفقوداً أو غير صالح كتاريخ.
// new Date(undefined).toISOString() يرمي RangeError: "Invalid time value"
// ويكسر طلب getOrders/getOrder بالكامل لهذا المستخدم. هذه الدالة تتعامل
// بأمان مع كل الحالات الممكنة وتُرجع null بدلاً من الانهيار.
function toIsoStringSafe(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as any).toDate === "function") {
    const d = (value as any).toDate();
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value as any);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ✅ إصلاح: يمنع استخدام نفس الكوبون أكثر من مرة من نفس المستخدم عبر مسار
// الموقع (createOrder/createDirectOrder) — نفس الحماية الموجودة أصلاً بقواعد
// Firestore الخاصة بتطبيق الأندرويد (coupons/{code}/usedBy/{uid})، والآن
// مطبّقة أيضاً هنا صراحة ضمن نفس الـtransaction التي تُنشئ الطلب وتزيد usageCount.
async function assertCouponNotUsedByUser(
  tx: FirebaseFirestore.Transaction,
  couponCode: string,
  userId: string
): Promise<FirebaseFirestore.DocumentReference> {
  const usedByRef = adminDb
    .collection("coupons").doc(couponCode)
    .collection("usedBy").doc(userId);
  const usedByDoc = await tx.get(usedByRef);
  if (usedByDoc.exists) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لقد استخدمت هذا الكوبون من قبل" });
  }
  return usedByRef;
}

// ✅ إصلاح تكرار: كان منطق الـtransaction بأكمله (قراءة المنتجات، حساب
// الشحن/الخصم، التحقق من الكوبون، خصم المخزون، توليد رقم الطلب) مكرَّراً
// شبه حرفياً بين createOrder وcreateDirectOrder — أي تعديل مستقبلي (ضريبة
// جديدة، منطق شحن مختلف...) كان يحتاج تطبيقه بمكانين منفصلين تماماً بخطر
// نسيان أحدهما. الآن createDirectOrder حالة خاصة (عنصر واحد) من نفس الدالة.
async function runOrderPricingTransaction(
  ctx: { user: { openId: string } },
  items: { productId: string; quantity: number }[],
  couponCode: string | undefined,
) {
  const counterRef = adminDb.collection("counters").doc("orders");

  return adminDb.runTransaction(async (tx) => {
    const productRefs = items.map(item => adminDb.collection("products").doc(item.productId));
    const productDocs = await Promise.all(productRefs.map(ref => tx.get(ref)));
    const settingsDoc = await tx.get(adminDb.collection("settings").doc("store"));
    const couponRef = couponCode ? adminDb.collection("coupons").doc(couponCode) : null;
    const couponDoc = couponRef ? await tx.get(couponRef) : null;
    const counterDoc = await tx.get(counterRef);
    // ✅ يجب أن يحدث التحقق من "usedBy" قبل أي write بالـtransaction (قيود Firestore)
    const usedByRef = couponCode
      ? await assertCouponNotUsedByUser(tx, couponCode, ctx.user.openId)
      : null;

    const authoritativeItems = productDocs.map((doc, idx) => {
      const item = items[idx];
      if (!doc.exists || doc.data()?.isActive === false) {
        throw new TRPCError({ code: "BAD_REQUEST", message: PRODUCT_NOT_FOUND_MSG });
      }
      const data = doc.data()!;
      const stock = data.stock ?? 0;
      if (item.quantity > stock) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${data.name}: ${OUT_OF_STOCK_MSG}` });
      }
      return {
        productId: item.productId,
        name: data.name,
        price: data.price, // ✅ من المنتج نفسه، وليس مما أرسله العميل
        quantity: item.quantity,
        image: data.images?.[0] || data.image || "",
      };
    });

    const subtotal = authoritativeItems.reduce((s, i) => s + i.price * i.quantity, 0);

    const settings = settingsDoc.exists ? settingsDoc.data()! : {};
    const shippingBase = Number(settings.shippingCost ?? 30);
    const freeShippingThreshold = Number(settings.freeShippingThreshold ?? 0);
    const shippingCost = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : shippingBase;

    let discountAmount = 0;
    let appliedCoupon: string | null = null;
    if (couponCode) {
      const coupon = couponDoc?.exists ? (couponDoc.data() as CouponDoc) : undefined;
      const result = checkCoupon(coupon, subtotal);
      if (!result.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      discountAmount = result.discountAmount;
      appliedCoupon = couponCode;
    }

    // كل عمليات الكتابة تأتي بعد كل عمليات القراءة أعلاه (قيد Firestore على الـtransactions)
    productDocs.forEach((doc, idx) => {
      const item = items[idx];
      const stock = doc.data()?.stock ?? 0;
      tx.update(productRefs[idx], { stock: stock - item.quantity, updatedAt: new Date() });
    });

    if (appliedCoupon && couponRef && usedByRef) {
      tx.update(couponRef, { usageCount: (couponDoc!.data()!.usageCount ?? 0) + 1, updatedAt: new Date() });
      // ✅ تسجيل استخدام هذا الكوبون من طرف هذا المستخدم — يمنع إعادة الاستخدام مستقبلاً
      tx.set(usedByRef, { userId: ctx.user.openId, usedAt: new Date() });
    }

    let nextNumber = 11001000;
    if (counterDoc.exists) {
      nextNumber = (counterDoc.data()?.current || 11001000) + 1;
    }
    tx.set(counterRef, { current: nextNumber }, { merge: true });
    const orderNumberString = nextNumber.toString();

    return {
      authoritativeItems,
      subtotal,
      discountAmount,
      shippingCost,
      total: Math.round((subtotal - discountAmount + shippingCost) * 100) / 100,
      appliedCoupon,
      orderNumberString,
    };
  });
}

// ✅ نظام الإشعارات v2: لا يوجد هنا أي استدعاء يدوي لإرسال إشعار الطلب بعد
// الآن. إشعار "تم استلام طلبك" (للعميل) و"طلب جديد" (للأدمن) يُنشَئهما الآن
// حصراً Cloud Function واحدة (functions/src/triggers/orderTriggers.ts::
// onOrderCreated) تلاحظ إنشاء مستند orders/{orderId} نفسه — بصرف النظر عن
// كون الطلب وصل من هنا (عبر السيرفر) أو مباشرة من تطبيق الأندرويد على
// Firestore (placeOrder). هذا يوحّد المسارين في نقطة واحدة فعلياً، ويضمن
// وصول Push حقيقي لصاحب المتجر حتى عن طلبات تطبيق الأندرويد (لم يكن هذا
// ممكناً سابقاً لأن العميل لا يملك صلاحية استدعاء Admin SDK لإرسال Push).

export const firestoreRouter = router({
  // --- المستخدمون ---
  updateFcmToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userRef = adminDb.collection("users").doc(ctx.user.openId);
      const { FieldValue } = await import("firebase-admin");
      // ✅ إصلاح حرج: كان يُستخدم هنا userRef.update() — وهو يفشل بصمت (يرمي
      // خطأ NOT_FOUND) إن لم تكن وثيقة users/{uid} موجودة بعد وقت وصول
      // التوكن (تعارض توقيت مع setDoc في صفحة التسجيل بالمتصفح). عندها
      // fcmTokens لا يُحفظ إطلاقاً، فلا يصل أي Push حقيقي لهذا المستخدم على
      // الموقع أبداً (سواء كان المتصفح مفتوحاً أو مغلقاً) — بينما الظاهر
      // للمستخدم كتنبيهات هو فقط الـToast الناتج عن الـpolling كل 20 ثانية،
      // وليس Push فعلي. نفس هذه العلّة بالضبط كانت مُصلحة سابقاً بجانب
      // الأندرويد (ElevenFirebaseMessagingService.kt::onNewToken) عبر
      // set(merge) بدل update() — الآن نطبّق نفس الإصلاح هنا للموقع.
      await userRef.set(
        {
          fcmTokens: FieldValue.arrayUnion(input.token),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      return { success: true };
    }),

  // ✅ جديد: يُستدعى عند تسجيل الخروج (قبل auth.signOut()) لحذف توكن *هذا
  // الجهاز تحديداً* من fcmTokens — وليس كل التوكنات (المستخدم قد يكون مسجّلاً
  // دخول على أكثر من جهاز). بدون هذا، لو استخدم شخص آخر نفس الجهاز بعد تسجيل
  // الخروج (جهاز مشترك) ودخل بحساب مختلف، يبقى توكن الحساب الأول مسجَّلاً
  // وموجّهاً فعلياً لنفس الجهاز — فأي إشعار يصل لاحقاً للحساب الأول (تفاصيل
  // طلب مثلاً) قد يظهر على جهاز الشخص الثاني الذي يستخدم الجهاز فعلياً الآن.
  removeFcmToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userRef = adminDb.collection("users").doc(ctx.user.openId);
      const { FieldValue } = await import("firebase-admin");
      await userRef.set(
        { fcmTokens: FieldValue.arrayRemove(input.token) },
        { merge: true }
      );
      return { success: true };
    }),

  // --- الكوبونات ---
  // معاينة فورية قبل إتمام الطلب — لا تلمس usageCount (الخصم الفعلي واستهلاك العدّاد يتمّان
  // فقط داخل createOrder ضمن transaction ذرّية حتى لا يُستخدم الكود أكثر من مرّته المسموحة).
  validateCoupon: protectedProcedure
    .input(z.object({ code: z.string().min(1), subtotal: z.number().min(0) }))
    .mutation(async ({ input, ctx }) => {
      // ✅ إصلاح (Audit المرحلة 3، بند 3.5): بدون هذا الحد، يمكن تخمين أكواد
      // كوبونات صالحة بالقوة الغاشمة (كل محاولة مجانية وسريعة). 30 محاولة كل
      // 5 دقائق لكل مستخدم مسجّل دخول تكفي بسهولة لأي استخدام شرعي بصفحة الدفع.
      if (!checkRateLimit(`validate-coupon:${ctx.user.openId}`, 30, 5 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "محاولات كثيرة جداً، حاول لاحقاً" });
      }
      const coupon = await fetchCoupon(input.code);
      const result = checkCoupon(coupon, input.subtotal);
      if (!result.valid) return { valid: false as const, message: result.message };
      // ✅ نفس التحقق "استخدام واحد لكل مستخدم" المُطبَّق فعلياً وبشكل ملزم عند
      // إنشاء الطلب (createOrder/createDirectOrder) — هنا فقط لإظهار رسالة واضحة
      // للمستخدم مبكراً قبل محاولة الدفع، وليس كخط الدفاع الوحيد.
      const code = input.code.trim().toUpperCase();
      const usedByDoc = await adminDb
        .collection("coupons").doc(code)
        .collection("usedBy").doc(ctx.user.openId).get();
      if (usedByDoc.exists) {
        return { valid: false as const, message: "لقد استخدمت هذا الكوبون من قبل" };
      }
      return {
        valid: true as const,
        discountAmount: result.discountAmount,
        discountType: result.coupon.discountType,
        discountValue: result.coupon.discountValue,
      };
    }),

  getCoupons: adminProcedure.query(async ({ ctx }) => {
    const snapshot = await adminDb.collection("coupons").orderBy("createdAt", "desc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  createCoupon: adminProcedure
    .input(z.object({
      code: z.string().min(1),
      discountType: z.enum(["percentage", "fixed"]),
      discountValue: z.number().positive(),
      isActive: z.boolean().default(true),
      minOrderAmount: z.number().min(0).default(0),
      usageLimit: z.number().min(0).default(0),
      expiresAt: z.string().optional(), // ISO date, optional
    }))
    .mutation(async ({ input, ctx }) => {
      const code = input.code.trim().toUpperCase();
      const ref = adminDb.collection("coupons").doc(code);
      if ((await ref.get()).exists) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يوجد كوبون بهذا الكود مسبقاً" });
      }
      await ref.set({
        code,
        discountType: input.discountType,
        discountValue: input.discountValue,
        isActive: input.isActive,
        minOrderAmount: input.minOrderAmount,
        usageLimit: input.usageLimit,
        usageCount: 0,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { success: true, code };
    }),

  updateCoupon: adminProcedure
    .input(z.object({
      code: z.string().min(1),
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.number().positive().optional(),
      isActive: z.boolean().optional(),
      minOrderAmount: z.number().min(0).optional(),
      usageLimit: z.number().min(0).optional(),
      expiresAt: z.string().nullable().optional(), // null = إزالة تاريخ الانتهاء
    }))
    .mutation(async ({ input, ctx }) => {
      const { code, expiresAt, ...rest } = input;
      const update: Record<string, any> = { ...rest, updatedAt: new Date() };
      if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
      await adminDb.collection("coupons").doc(code.trim().toUpperCase()).update(update);
      return { success: true };
    }),

  deleteCoupon: adminProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("coupons").doc(input.code.trim().toUpperCase()).delete();
      return { success: true };
    }),

  // --- التصنيفات ---
  getCategories: publicProcedure.query(async () => {
    const snapshot = await adminDb.collection("categories").where("isActive", "==", true).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  // --- العلامات التجارية ---
  getBrands: publicProcedure.query(async () => {
    const snapshot = await adminDb.collection("brands").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  createBrand: adminProcedure
    .input(z.object({
      name: z.string(),
      logo: z.string(),
      link: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const docRef = await adminDb.collection("brands").add({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: docRef.id, success: true };
    }),

  updateBrand: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      logo: z.string().optional(),
      link: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await adminDb.collection("brands").doc(id).update({
        ...data,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  deleteBrand: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("brands").doc(input.id).delete();
      return { success: true };
    }),

  // --- المنتجات (معدلة) ---
  getProducts: publicProcedure
    .input(z.object({
      categoryId:   z.string().optional(),
      isFeatured:   z.boolean().optional(),
      onSale:       z.boolean().optional(),
      brandId:      z.string().optional(),
      isBestSeller: z.boolean().optional(),
      isNew:        z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      // ── الفهارس المركبة المفعّلة في Firestore (انظر firestore.indexes.json) ──
      //  1. isActive + isFeatured + createdAt DESC
      //  2. isActive + createdAt DESC
      //  3. isActive + categoryId + isFeatured + createdAt DESC
      //  4. isActive + categoryId + createdAt DESC
      //  5. isActive + isOnSale + createdAt DESC
      //  6. isActive + isBestSeller + createdAt DESC
      //  7. isActive + brandId + createdAt DESC
      //  8. isActive + categoryId + isOnSale + createdAt DESC
      //  9. isActive + categoryId + isBestSeller + createdAt DESC
      // 10. isActive + categoryId + brandId + createdAt DESC
      //
      // ✅ إصلاح جوهري: الفروع الحصرية (if/else if) القديمة هنا كانت تُسقِط
      // أي فلتر ثانٍ بصمت متى ما كان categoryId موجوداً معه (مثال: تحديد فئة
      // + "العروض" كان يتجاهل onSale تماماً ويُرجع كل منتجات الفئة؛ وتحديد
      // فئة + علامة تجارية كان يتجاهل brandId بنفس الطريقة) — نتائج غير
      // صحيحة على الموقع، وتُخالف منطق تطبيق الأندرويد (FirestoreRepository
      // .getProducts) الذي يُركِّب كل شرط .whereEqualTo() المطلوب دفعة واحدة
      // دون استبعاد أي منها. أصبح البناء هنا تركيبياً (compositional) بنفس
      // طريقة الأندرويد تماماً، فتتطابق النتائج بين المنصتين لكل نفس المدخلات.
      let query: any = adminDb.collection("products").where("isActive", "==", true);

      if (input?.categoryId) {
        query = query.where("categoryId", "==", input.categoryId);
      }
      if (input?.brandId) {
        query = query.where("brandId", "==", input.brandId);
      }
      if (input?.isFeatured) {
        query = query.where("isFeatured", "==", true);
      }
      if (input?.onSale) {
        query = query.where("isOnSale", "==", true);
      }
      if (input?.isBestSeller) {
        query = query.where("isBestSeller", "==", true);
      }
      if (input?.isNew) {
        // "جديد" = أُضيف خلال آخر 30 يوماً (لا يوجد حقل Boolean فعلي isNew على
        // أي مستند). النطاق هنا يقع على نفس حقل الترتيب (createdAt) فلا
        // يتطلب فهرساً إضافياً غير الفهرس المستخدم أصلاً لنفس تركيبة الفلاتر
        // الأخرى (مثال: categoryId+isNew يستخدم نفس فهرس categoryId+createdAt).
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query = query.where("createdAt", ">=", thirtyDaysAgo);
      }
      query = query.orderBy("createdAt", "desc");

      const snapshot = await query.limit(100).get();
      // ✅ لا تُعرض المنتجات التي نفدت كميتها (stock <= 0) في صفحات المنتجات
      return snapshot.docs
        .map((doc: any) => ({ id: doc.id, ...doc.data() }))
        .filter((p: any) => (p.stock ?? 0) > 0);
    }),

  // ✅ جديد: لوحة تحكم الأدمن لإدارة المنتجات كانت تستخدم getProducts
  // العام نفسه (المخصَّص لعرض المتجر للزوار) — وهو يُخفي أي منتج غير نشط
  // (isActive=false) أو نافد المخزون (stock<=0) بالتصميم. أثر ذلك: أي منتج
  // يُعطَّل أو تنفد كميته كان يختفي فوراً من قائمة إدارة المنتجات بلوحة
  // التحكم أيضاً — فلا يستطيع الأدمن رؤيته لتعديله أو إعادة تفعيله أو تجديد
  // مخزونه، دون أي رسالة أو تفسير. هذا الإجراء الجديد (على غرار
  // getAllBannersAdmin/getAllOrdersAdmin) يُرجع كل المنتجات دون أي استبعاد،
  // محمياً بـadminProcedure (صلاحية أدمن فقط).
  getAllProductsAdmin: adminProcedure.query(async ({ ctx }) => {
    const snapshot = await adminDb.collection("products").orderBy("createdAt", "desc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  // --- المنتجات الجديدة (حسب تاريخ الإضافة) ---
  // ⚠️ ملاحظة: لم تعد Products.tsx تستخدم هذا المسار لنفس سبب getBestSellers
  // أعلاه (getProducts الموحّد بـisNew:true يتركّب صحيحاً مع categoryId).
  // أُبقي للاستخدام الخارجي المحتمل فقط.
  getNewProducts: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
    }).optional())
    .query(async ({ input }) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const snapshot = await adminDb
        .collection("products")
        .where("isActive", "==", true)
        .where("createdAt", ">=", thirtyDaysAgo)
        .orderBy("createdAt", "desc")
        .limit(input?.limit || 10)
        .get();
      
      return snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((p: any) => (p.stock ?? 0) > 0);
    }),

  // --- الأكثر مبيعاً --- فهرس 6: isActive + isBestSeller + createdAt DESC ✅
  // ⚠️ ملاحظة: لم تعد Products.tsx تستخدم هذا المسار (تستخدم الآن getProducts
  // الموحّد بـisBestSeller:true حتى يتركّب صحيحاً مع categoryId — انظر
  // التعليق أعلى getProducts). أُبقي هذا الإجراء لأي استهلاك خارجي محتمل
  // للـAPI، وأُصلح نقص orderBy فيه (كان يُرجع النتائج بترتيب مستند/إدراج غير
  // محدَّد بدل الأحدث أولاً، خلافاً لكل مسارات "الأحدث أولاً" الأخرى بالتطبيق).
  getBestSellers: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
    }).optional())
    .query(async ({ input }) => {
      const snapshot = await adminDb
        .collection("products")
        .where("isActive", "==", true)
        .where("isBestSeller", "==", true)
        .orderBy("createdAt", "desc")
        .limit(input?.limit || 10)
        .get();
      return snapshot.docs
        .map((doc: any) => ({ id: doc.id, ...doc.data() }))
        .filter((p: any) => (p.stock ?? 0) > 0);
    }),

  getProduct: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const doc = await adminDb.collection("products").doc(input.id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  // --- سلة التسوق ---
  getCart: protectedProcedure.query(async ({ ctx }) => {
    const cartRef = adminDb.collection("users").doc(ctx.user.openId).collection("cart");
    const snapshot = await cartRef.get();
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    if (items.length === 0) return [];

    // نجلب أحدث بيانات المخزون لكل منتج في السلة حتى تعكس الواجهة الكمية المتاحة فعلياً
    const productDocs = await Promise.all(
      items.map((item: any) => adminDb.collection("products").doc(item.productId).get())
    );

    const batch = adminDb.batch();
    let needsCommit = false;
    const result: any[] = [];

    items.forEach((item: any, idx: number) => {
      const productDoc = productDocs[idx];
      const productData = productDoc.exists ? (productDoc.data() as any) : null;

      // المنتج لم يعد موجوداً أو أصبح غير نشط: نحذفه تلقائياً من السلة
      if (!productData || productData.isActive === false) {
        batch.delete(cartRef.doc(item.id));
        needsCommit = true;
        return;
      }

      const stock = productData.stock ?? 0;

      // إن نفدت الكمية كلياً نحذف العنصر من السلة
      if (stock <= 0) {
        batch.delete(cartRef.doc(item.id));
        needsCommit = true;
        return;
      }

      // إن كانت الكمية المطلوبة أكبر من المتاح، نقلصها تلقائياً لأقصى كمية متاحة
      let quantity = item.quantity;
      if (quantity > stock) {
        quantity = stock;
        batch.update(cartRef.doc(item.id), { quantity, updatedAt: new Date() });
        needsCommit = true;
      }

      result.push({
        ...item,
        quantity,
        price: productData.price ?? item.price,
        stock,
      });
    });

    if (needsCommit) await batch.commit();
    return result;
  }),

  addToCart: protectedProcedure
    .input(z.object({
      productId: z.string(),
      quantity: z.number().min(1),
      price: z.number(),
      name: z.string(),
      image: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const productRef = adminDb.collection("products").doc(input.productId);
      const cartRef = adminDb.collection("users").doc(ctx.user.openId).collection("cart").doc(input.productId);

      await adminDb.runTransaction(async (tx) => {
        const productDoc = await tx.get(productRef);
        if (!productDoc.exists || productDoc.data()?.isActive === false) {
          throw new TRPCError({ code: "NOT_FOUND", message: PRODUCT_NOT_FOUND_MSG });
        }

        const stock = productDoc.data()?.stock ?? 0;
        if (stock <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: OUT_OF_STOCK_MSG });
        }

        const cartDoc = await tx.get(cartRef);
        const currentQuantity = cartDoc.exists ? (cartDoc.data()?.quantity || 0) : 0;
        const requestedQuantity = currentQuantity + input.quantity;

        // ✅ لا نسمح بتجاوز الكمية المتوفرة في المخزون عند الإضافة للسلة
        if (requestedQuantity > stock) {
          throw new TRPCError({ code: "BAD_REQUEST", message: OUT_OF_STOCK_MSG });
        }

        if (cartDoc.exists) {
          tx.update(cartRef, { quantity: requestedQuantity, updatedAt: new Date() });
        } else {
          tx.set(cartRef, { ...input, quantity: requestedQuantity, createdAt: new Date(), updatedAt: new Date() });
        }
      });

      return { success: true };
    }),

  // ✅ تعديل الكمية يتم من السلة فقط: يضبط الكمية على قيمة مطلقة مع الالتزام بحد المخزون
  updateCartQuantity: protectedProcedure
    .input(z.object({
      productId: z.string(),
      quantity: z.number().min(0), // 0 = حذف العنصر من السلة
    }))
    .mutation(async ({ input, ctx }) => {
      const cartRef = adminDb.collection("users").doc(ctx.user.openId).collection("cart").doc(input.productId);

      if (input.quantity <= 0) {
        await cartRef.delete();
        return { success: true, quantity: 0 };
      }

      const productRef = adminDb.collection("products").doc(input.productId);
      const productDoc = await productRef.get();
      if (!productDoc.exists || productDoc.data()?.isActive === false) {
        await cartRef.delete();
        throw new TRPCError({ code: "NOT_FOUND", message: PRODUCT_NOT_FOUND_MSG });
      }

      const stock = productDoc.data()?.stock ?? 0;
      if (stock <= 0) {
        await cartRef.delete();
        throw new TRPCError({ code: "BAD_REQUEST", message: OUT_OF_STOCK_MSG });
      }

      // ✅ تقييد التعديل بالكمية المتوفرة فعلياً في المخزون
      const finalQuantity = Math.min(input.quantity, stock);
      const cartDoc = await cartRef.get();

      if (cartDoc.exists) {
        await cartRef.update({ quantity: finalQuantity, updatedAt: new Date() });
      } else {
        const productData = productDoc.data() as any;
        await cartRef.set({
          productId: input.productId,
          quantity: finalQuantity,
          price: productData.price,
          name: productData.name,
          image: productData.images?.[0] || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return { success: true, quantity: finalQuantity, capped: finalQuantity < input.quantity };
    }),

  removeFromCart: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("users").doc(ctx.user.openId).collection("cart").doc(input.productId).delete();
      return { success: true };
    }),

  // --- المفضلة ---
  getFavorites: protectedProcedure.query(async ({ ctx }) => {
    const favRef = adminDb.collection("users").doc(ctx.user.openId).collection("favorites");
    const snapshot = await favRef.get();
    if (snapshot.empty) return [];

    // ✅ نجلب بيانات المنتج الحية (الاسم/السعر/الصورة/المخزون) لكل عنصر مفضلة،
    // بنفس أسلوب getCart تماماً — بدون هذا الدمج كانت البطاقات تُعرض فارغة
    const favDocs = snapshot.docs;
    const productDocs = await Promise.all(
      favDocs.map(doc => adminDb.collection("products").doc(doc.data()?.productId || doc.id).get())
    );

    const batch = adminDb.batch();
    let needsCommit = false;
    const result: any[] = [];

    favDocs.forEach((favDoc, idx) => {
      const productDoc = productDocs[idx];
      const productData = productDoc.exists ? (productDoc.data() as any) : null;

      // المنتج لم يعد موجوداً أو أصبح غير نشط: نحذفه تلقائياً من المفضلة
      if (!productData || productData.isActive === false) {
        batch.delete(favRef.doc(favDoc.id));
        needsCommit = true;
        return;
      }

      result.push({
        id: productDoc.id,
        productId: productDoc.id,
        name: productData.name,
        price: productData.price,
        image: productData.images?.[0] || productData.image || "",
        stock: productData.stock ?? 0,
      });
    });

    if (needsCommit) await batch.commit();
    return result;
  }),

  toggleFavorite: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const favRef = adminDb.collection("users").doc(ctx.user.openId).collection("favorites").doc(input.productId);
      const doc = await favRef.get();
      
      if (doc.exists) {
        await favRef.delete();
        return { favorited: false };
      } else {
        await favRef.set({
          productId: input.productId,
          createdAt: new Date()
        });
        return { favorited: true };
      }
    }),

  // --- العناوين ---
  getAddresses: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await adminDb.collection("users").doc(ctx.user.openId).collection("addresses").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  addAddress: protectedProcedure
    .input(z.object({
      fullName: z.string(),
      phone: z.string(),
      city: z.string(),
      address: z.string(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const userRef = adminDb.collection("users").doc(ctx.user.openId);
      
      if (input.isDefault) {
        const snapshot = await userRef.collection("addresses").where("isDefault", "==", true).get();
        const { FieldValue } = await import("firebase-admin");
        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => batch.update(doc.ref, { isDefault: false }));
        await batch.commit();
      }
      
      const docRef = await userRef.collection("addresses").add({
        ...input,
        createdAt: new Date()
      });
      return { id: docRef.id, success: true };
    }),

  updateAddress: protectedProcedure
    .input(z.object({
      id: z.string(),
      fullName: z.string(),
      phone: z.string(),
      city: z.string(),
      address: z.string(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const userRef = adminDb.collection("users").doc(ctx.user.openId);

      if (data.isDefault) {
        const snapshot = await userRef.collection("addresses").where("isDefault", "==", true).get();
        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => { if (doc.id !== id) batch.update(doc.ref, { isDefault: false }); });
        await batch.commit();
      }

      await userRef.collection("addresses").doc(id).update({
        ...data,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  deleteAddress: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("users").doc(ctx.user.openId).collection("addresses").doc(input.id).delete();
      return { success: true };
    }),

  // --- الطلبات ---
  getOrders: protectedProcedure.query(async ({ ctx }) => {
    // ✅ إصلاح (Audit المرحلة 5، قواعد البيانات): لم يكن هناك أي حد — كل
    // فتح لصفحة "طلباتي" كان يجلب كل طلبات المستخدم منذ إنشاء حسابه دفعة
    // واحدة. حد 100 كافٍ عملياً لأي مستخدم حقيقي (لا يوجد أي عميل بمتجر
    // إلكتروني يملك أكثر من 100 طلب سابق فعلياً)، ويحمي من نمو غير محدود
    // مستقبلاً. لعرض أكثر من ذلك لاحقاً، الحل الصحيح صفحات (pagination) عبر
    // startAfter، وليس رفع الرقم فقط.
    const snapshot = await adminDb.collection("orders")
      .where("userId", "==", ctx.user.openId)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: toIsoStringSafe(data?.createdAt),
        updatedAt: toIsoStringSafe(data?.updatedAt),
      };
    });
  }),

  getOrder: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await adminDb.collection("orders").doc(input.id).get();
      if (!doc.exists) return null;
      const data = doc.data();
      // ✅ إصلاح ثغرة حرجة: كان يُرمى `Error` عادي هنا، وتِRPC يترجم أي خطأ غير
      // مصنَّف إلى 500 INTERNAL_SERVER_ERROR — وليس 403. الآن نستخدم TRPCError
      // بالكود FORBIDDEN الذي يُترجم فعلياً إلى HTTP 403 Unauthorized، ويمنع
      // بشكل صريح قراءة فاتورة/طلب أي مستخدم آخر عبر رابط مباشر (/order/:id)
      // إلا لصاحب الطلب نفسه أو المدير.
      if (data?.userId !== ctx.user.openId && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض هذه الفاتورة" });
      }
      return {
        id: doc.id,
        ...data,
        createdAt: toIsoStringSafe(data?.createdAt),
        updatedAt: toIsoStringSafe(data?.updatedAt),
      };
    }),

  createOrder: protectedProcedure
    .input(z.object({
      // ✅ لا نقبل price/name/total من العميل إطلاقاً — يُعاد بناؤها من قاعدة البيانات
      // داخل الـtransaction لمنع التلاعب بالسعر النهائي للطلب.
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().min(1),
      })),
      couponCode: z.string().optional(),
      shippingAddress: z.any(),
      paymentMethod: z.string(),
      paymentReceipt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const verificationToken = generateVerificationToken();
      const couponCode = input.couponCode?.trim().toUpperCase();

      // ✅ إصلاح: رقم الطلب يُستهلك الآن داخل نفس الـtransaction الذرّية
      // للتحقق/الحجز (وليس بـtransaction منفصلة قبلها). سابقاً كان الرقم
      // يُستهلك أولاً دائماً بلا شرط — فأي فشل لاحق (نفاد مخزون، كوبون غير
      // صالح...) يترك "فجوة" دائمة في تسلسل أرقام الطلبات رغم عدم إنشاء أي
      // طلب فعلياً. الآن لا يُستهلك الرقم إلا بعد نجاح كل عمليات التحقق.
      const { authoritativeItems, subtotal, discountAmount, shippingCost, total, appliedCoupon, orderNumberString } =
        await runOrderPricingTransaction(ctx, input.items, couponCode);

      const orderData = {
        items: authoritativeItems,
        subtotal,
        discount: discountAmount, // ✅ نفس اسم الحقل الذي يقرأه تطبيق الأندرويد (Order.discount)
        couponCode: appliedCoupon,
        shippingCost,
        total,
        shippingAddress: input.shippingAddress,
        paymentMethod: input.paymentMethod,
        paymentReceipt: input.paymentReceipt,
        userId: ctx.user.openId,
        orderNumber: orderNumberString,
        verificationToken,
        status: "pending",
        // ✅ إصلاح: كان يُضبط "paid" تلقائياً بمجرد وجود ملف مرفوع، دون أي
        // تحقق فعلي من محتواه — أصبح الآن "بانتظار المراجعة" ريثما يراجع
        // الأدمن صورة الإيصال فعلياً من لوحة التحكم ويؤكدها يدوياً.
        paymentStatus: input.paymentReceipt ? "pending_review" : "unpaid",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const docRef = await adminDb.collection("orders").add(orderData);
      
      const cartSnapshot = await adminDb.collection("users").doc(ctx.user.openId).collection("cart").get();
      const batch = adminDb.batch();
      cartSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      // إشعارا "تم استلام طلبك" و"طلب جديد" يصلان تلقائياً عبر Cloud Function
      // (onOrderCreated) بمجرد نجاح docRef.set أعلاه — لا استدعاء يدوي هنا.

      // ✅ Algolia: المخزون تغيّر داخل runOrderPricingTransaction أعلاه —
      // نزامن سجلات المنتجات المتأثرة الآن (بعد نجاح الطلب بالكامل)، حتى لا
      // يظهر منتج نفد مخزونه للتو ضمن نتائج بحث Algolia لعميل آخر.
      resyncProductsStock(authoritativeItems.map(i => i.productId)).catch(() => {});

      return { id: docRef.id, orderNumber: orderNumberString, success: true };
    }),

  createDirectOrder: protectedProcedure
    .input(z.object({
      // ✅ لا price/name/total من العميل — تُشتق من المنتج نفسه (نفس مبدأ createOrder)
      productId: z.string(),
      quantity: z.number().min(1),
      couponCode: z.string().optional(),
      shippingAddress: z.any(),
      paymentMethod: z.string(),
      paymentReceipt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const verificationToken = generateVerificationToken();
      const couponCode = input.couponCode?.trim().toUpperCase();

      // ✅ إصلاح تكرار: أصبح "شراء الآن" حالة خاصة (عنصر واحد) من نفس دالة
      // التسعير المستخدمة في createOrder — بدل نسخة كاملة منفصلة من نفس المنطق.
      const { authoritativeItems, subtotal, discountAmount, shippingCost, total, appliedCoupon, orderNumberString } =
        await runOrderPricingTransaction(
          ctx,
          [{ productId: input.productId, quantity: input.quantity }],
          couponCode,
        );
      const item = authoritativeItems[0];

      const orderData = {
        userId: ctx.user.openId,
        orderNumber: orderNumberString,
        verificationToken,
        items: [item],
        subtotal,
        discount: discountAmount,
        couponCode: appliedCoupon,
        shippingCost,
        total,
        shippingAddress: input.shippingAddress,
        paymentMethod: input.paymentMethod,
        paymentReceipt: input.paymentReceipt,
        status: "pending",
        // ✅ إصلاح: كان يُضبط "paid" تلقائياً بمجرد وجود ملف مرفوع، دون أي
        // تحقق فعلي من محتواه — أصبح الآن "بانتظار المراجعة" ريثما يراجع
        // الأدمن صورة الإيصال فعلياً من لوحة التحكم ويؤكدها يدوياً.
        paymentStatus: input.paymentReceipt ? "pending_review" : "unpaid",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const docRef = await adminDb.collection("orders").add(orderData);
      
      // نفس ملاحظة createOrder: onOrderCreated (Cloud Function) يتكفّل بإشعارَي
      // العميل والأدمن تلقائياً بمجرد إنشاء docRef أعلاه.

      // ✅ Algolia: نفس إصلاح createOrder — إعادة مزامنة المخزون بعد نجاح الطلب
      resyncProductsStock([item.productId]).catch(() => {});

      return { id: docRef.id, orderNumber: orderNumberString, success: true };
    }),

  // --- إعدادات المتجر ---
  getStoreSettings: publicProcedure.query(async () => {
    const doc = await adminDb.collection("settings").doc("store").get();
    return doc.exists ? doc.data() : null;
  }),

  updateStoreSettings: adminProcedure
    .input(z.object({
      storeName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      shippingCost: z.number().optional(),
      freeShippingThreshold: z.number().optional(),
      bankName: z.string().optional(),
      bankAccountName: z.string().optional(),
      bankAccountNumber: z.string().optional(),
      whatsapp: z.string().optional(),
      facebook: z.string().optional(),
      instagram: z.string().optional(),
      twitter: z.string().optional(),
      lowStockThreshold: z.number().optional(),
      storeDescription: z.string().optional(),
      storeVision: z.string().optional(),
      storeMission: z.string().optional(),
      storeAboutImage: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("settings").doc("store").set({
        ...input,
        updatedAt: new Date(),
      }, { merge: true });
      return { success: true };
    }),

  // --- بانرات ---
  getBanners: publicProcedure.query(async () => {
    const snapshot = await adminDb.collection("banners")
      .where("isActive", "==", true)
      .orderBy("order", "asc")
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  getAllBannersAdmin: adminProcedure.query(async ({ ctx }) => {
    const snapshot = await adminDb.collection("banners").orderBy("order", "asc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }),

  createBanner: adminProcedure
    .input(z.object({
      title: z.string(),
      description: z.string(),
      image: z.string().optional(),
      cta: z.string().default("تسوق الآن"),
      order: z.number().default(0),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const docRef = await adminDb.collection("banners").add({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: docRef.id, success: true };
    }),

  updateBanner: adminProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      cta: z.string().optional(),
      order: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await adminDb.collection("banners").doc(id).update({
        ...data,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  deleteBanner: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("banners").doc(input.id).delete();
      return { success: true };
    }),

  // --- إدارة التصنيفات ---
  createCategory: adminProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      image: z.string().optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const docRef = await adminDb.collection("categories").add({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: docRef.id, success: true };
    }),

  updateCategory: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await adminDb.collection("categories").doc(id).update({
        ...data,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  deleteCategory: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("categories").doc(input.id).delete();
      return { success: true };
    }),

  // --- إدارة المنتجات ---
  createProduct: adminProcedure
    .input(z.object({
      name: z.string(),
      description: z.string(),
      basePrice: z.number(),
      price: z.number(),
      originalPrice: z.number().optional(),
      categoryId: z.string(),
      brandId: z.string().optional(),
      images: z.array(z.string()).default([]),
      stock: z.number().default(0),
      isFeatured: z.boolean().default(false),
      isOnSale: z.boolean().default(false),
      // ✅ إصلاح: isBestSeller لم يكن مقبولاً بالمخطط إطلاقاً — أي منتج لم يكن هناك
      // طريقة عملية لجعله يظهر ضمن "الأكثر مبيعاً" على الموقع أو التطبيق (كان القسم
      // يختفي بصمت دائماً لأن الحقل غير موجود بأي مستند).
      isBestSeller: z.boolean().default(false),
      discountType: z.enum(['percentage', 'fixed']).optional(),
      discountValue: z.number().optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const docRef = await adminDb.collection("products").add({
        ...input,
        createdAt: now,
        updatedAt: now,
      });
      // ✅ Algolia: مزامنة فورية بعد نجاح الكتابة على Firestore. لا تُوقف
      // العملية إن فشلت (انظر تعليق syncProductToIndex) — المصدر الحقيقي
      // للبيانات يبقى Firestore دائماً.
      await syncProductToIndex(docRef.id, { ...input, createdAt: now });
      return { id: docRef.id, success: true };
    }),

  updateProduct: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      basePrice: z.number().optional(),
      price: z.number().optional(),
      originalPrice: z.number().optional(),
      categoryId: z.string().optional(),
      brandId: z.string().optional(),
      images: z.array(z.string()).optional(),
      stock: z.number().optional(),
      isFeatured: z.boolean().optional(),
      isOnSale: z.boolean().optional(),
      isBestSeller: z.boolean().optional(), // ✅ إصلاح — انظر نفس الملاحظة في createProduct
      discountType: z.enum(['percentage', 'fixed']).optional(),
      discountValue: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await adminDb.collection("products").doc(id).update({
        ...data,
        updatedAt: new Date(),
      });
      // ✅ Algolia: updateProduct يقبل حقولاً جزئية فقط (كلها .optional())،
      // لذا نعيد قراءة المستند الكامل بعد التحديث بدل دمج `data` الجزئي —
      // وإلا يُخاطَر بإرسال سجل فهرسة ناقص يمحو حقولاً لم تتغيّر أصلاً.
      const updatedDoc = await adminDb.collection("products").doc(id).get();
      if (updatedDoc.exists) {
        await syncProductToIndex(id, updatedDoc.data()!);
      }
      return { success: true };
    }),

  deleteProduct: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("products").doc(input.id).delete();
      await removeProductFromIndex(input.id);
      return { success: true };
    }),

  // --- إدارة الطلبات ---
  getAllOrdersAdmin: adminProcedure
    .input(z.object({
      status: z.enum(['all', 'pending', 'paid', 'shipped', 'delivered', 'cancelled']).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {

      // ملاحظة: الفلترة بالحالة تحتاج فهرساً مركّباً (status ASC + createdAt DESC)
      // على مجموعة "orders" بـ Firestore Console. تأكد أنه Enabled قبل النشر.
      // (✅ الآن معرَّف أيضاً بملف firestore.indexes.json القابل للنشر بأمر واحد
      // بدل الاعتماد فقط على إنشائه يدوياً من رابط خطأ بالـConsole).
      //
      // ✅ إصلاح (Audit المرحلة 5): لم يكن هناك أي حد — كل فتح لتبويب "الطلبات"
      // بلوحة التحكم كان يجلب كل طلب سُجِّل بالمتجر منذ أول يوم دفعة واحدة.
      // 500 كحد أقصى يغطي فعلياً أي متجر متوسط الحجم دون إبطاء اللوحة. الحل
      // الكامل طويل المدى: صفحات فعلية (startAfter) بدل رفع الرقم فقط —
      // موصى به ضمن المرحلة 12 (الشاشات) حين تُراجَع واجهة لوحة التحكم.
      const ORDERS_ADMIN_LIMIT = 500;
      let query: any = adminDb.collection("orders").orderBy("createdAt", "desc").limit(ORDERS_ADMIN_LIMIT);
      if (input?.status && input.status !== 'all') {
        query = adminDb.collection("orders")
          .where("status", "==", input.status)
          .orderBy("createdAt", "desc")
          .limit(ORDERS_ADMIN_LIMIT);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // ✅ إصلاح: كان يستخدم new Date(data?.createdAt).toISOString() مباشرة —
          // يرمي RangeError ويكسر الطلب بالكامل إذا كان أي طلب واحد بقاعدة البيانات
          // بتاريخ مفقود/غير صالح (يحدث مع الطلبات المكتوبة من تطبيق الأندرويد
          // مباشرة عبر Firestore Client SDK). نفس الإصلاح المطبّق أصلاً بـ
          // getOrders/getOrder لكنه كان منسياً هنا تحديداً — وهذا الإجراء بالذات
          // هو ما تستخدمه لوحة التحكم لعرض تبويب "الطلبات".
          createdAt: toIsoStringSafe(data?.createdAt),
          updatedAt: toIsoStringSafe(data?.updatedAt),
        };
      });
    }),

  updateOrderStatus: adminProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
      paymentStatus: z.enum(['unpaid', 'paid', 'failed']).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const orderRef = adminDb.collection("orders").doc(id);

      // ✅ إصلاح حرج: لم يكن هناك أي منطق لإرجاع المخزون عند إلغاء طلب —
      // المخزون المخصوم وقت الإنشاء (createOrder/createDirectOrder) كان يضيع
      // نهائياً عند أي إلغاء لاحق من الأدمن، فيظهر المنتج بمخزون أقل من
      // الحقيقي بشكل تراكمي مع الوقت. الآن، عند الانتقال *إلى* 'cancelled'
      // من حالة لم تكن 'cancelled' من قبل، نُرجع كمية كل عنصر لمخزون منتجه
      // ضمن transaction ذرّية، ونضع علامة orderData.stockRestored لمنع أي
      // إرجاع مضاعف لاحقاً (مثال: استدعاء الدالة أكثر من مرة بنفس الحالة).
      const { orderData, orderNumber, userId } = await adminDb.runTransaction(async (tx) => {
        const orderDoc = await tx.get(orderRef);
        if (!orderDoc.exists) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
        }
        const orderData = orderDoc.data()!;
        const wasCancelled = orderData.status === 'cancelled';
        const willBeCancelled = input.status === 'cancelled';
        const alreadyRestored = orderData.stockRestored === true;

        let productRefs: FirebaseFirestore.DocumentReference[] = [];
        let productDocs: FirebaseFirestore.DocumentSnapshot[] = [];
        if (willBeCancelled && !wasCancelled && !alreadyRestored && Array.isArray(orderData.items)) {
          productRefs = orderData.items.map((item: any) => adminDb.collection("products").doc(item.productId));
          productDocs = await Promise.all(productRefs.map((ref) => tx.get(ref)));
        }

        tx.update(orderRef, {
          ...data,
          ...(willBeCancelled && !wasCancelled && !alreadyRestored ? { stockRestored: true } : {}),
          updatedAt: new Date(),
        });

        if (productDocs.length > 0) {
          productDocs.forEach((doc, idx) => {
            if (!doc.exists) return; // المنتج قد يكون حُذف لاحقاً — لا يوجد ما نُرجع له
            const item = orderData.items[idx];
            const currentStock = doc.data()?.stock ?? 0;
            tx.update(productRefs[idx], {
              stock: currentStock + (item.quantity || 0),
              updatedAt: new Date(),
            });
          });
        }

        return { orderData, orderNumber: orderData.orderNumber, userId: orderData.userId };
      });

      // ✅ Algolia: إن أُرجع مخزون داخل الـtransaction أعلاه، نزامن سجلات
      // المنتجات المتأثرة (منتج نفد كان مستبعَداً من الفهرس قد يعود متاحاً الآن).
      if (Array.isArray(orderData.items)) {
        resyncProductsStock(orderData.items.map((item: any) => item.productId)).catch(() => {});
      }

      // إشعار "تحديث حالة الطلب" يصل تلقائياً عبر Cloud Function
      // (onOrderStatusChanged) بمجرد نجاح تعديل حقل status أعلاه — تلاحظ
      // الدالة الفرق بين القيمة السابقة والجديدة لهذا الحقل تحديداً، فلا
      // تُنشئ أي إشعار عند تعديل حقول أخرى بالطلب لا تخص الحالة.

      return { success: true };
    }),

  deleteOrder: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await adminDb.collection("orders").doc(input.id).delete();
      return { success: true };
    }),

  updateOrderReceipt: protectedProcedure
    .input(z.object({
      orderId: z.string(),
      paymentReceipt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orderRef = adminDb.collection("orders").doc(input.orderId);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
      }
      
      const orderData = orderDoc.data();
      if (orderData?.userId !== ctx.user.openId && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بهذا الإجراء" });
      }
      
      await orderRef.update({
        paymentReceipt: input.paymentReceipt,
        paymentStatus: "paid",
        updatedAt: new Date(),
      });
      
      return { success: true };
    }),

  // --- الإحصائيات المحسّنة ---
  getAdminStats: adminProcedure
    .query(async ({ ctx }) => {
      
      const productsSnapshot = await adminDb.collection("products").get();
      const ordersSnapshot = await adminDb.collection("orders").get();
      // ✅ إصلاح (Audit المرحلة 5/17): كان يُجلَب كل مستند فئة كاملاً فقط
      // لاستخدام العدد (.size) — استعلام العدّ المُجمَّع (count aggregation)
      // يكلّف قراءة مستند واحدة فقط بصرف النظر عن عدد الفئات الفعلي، بدل
      // قراءة كل مستند بالكامل. لا يمسّ هذا أي منطق حساب آخر (الإيرادات/
      // المنتجات الأكثر مبيعاً ما زالت تعتمد القراءة الكاملة لـproducts/orders
      // كما هي، لأنها تحتاج فعلاً محتوى كل مستند وليس عدده فقط).
      const categoriesCountSnapshot = await adminDb.collection("categories").count().get();
      
      const settingsDoc = await adminDb.collection("settings").doc("store").get();
      const lowStockThreshold = settingsDoc.exists ? (settingsDoc.data()?.lowStockThreshold || 5) : 5;

      let totalRevenue = 0;
      let pendingOrders = 0;
      let completedOrders = 0;
      
      const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
      
      ordersSnapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        if (data.status === 'delivered') {
          totalRevenue += Number(data.total) || 0;
          completedOrders++;
        }
        if (data.status === 'pending' || data.status === 'paid' || data.status === 'shipped') {
          pendingOrders++;
        }
        if (data.status !== 'cancelled' && data.items) {
          data.items.forEach((item: any) => {
            if (!productSales[item.productId]) {
              productSales[item.productId] = { name: item.name, quantity: 0, revenue: 0 };
            }
            productSales[item.productId].quantity += item.quantity || 0;
            productSales[item.productId].revenue += (item.price * item.quantity) || 0;
          });
        }
      });

      const lowStockProducts = productsSnapshot.docs
        .filter((doc: any) => {
          const data = doc.data();
          return data.isActive && data.stock <= lowStockThreshold;
        })
        .map((doc: any) => ({ id: doc.id, name: doc.data().name, stock: doc.data().stock }));

      const topProducts = Object.entries(productSales)
        .sort(([, a], [, b]) => b.quantity - a.quantity)
        .slice(0, 5)
        .map(([productId, data]) => ({ productId, ...data }));

      let totalCustomers = 0;
      try {
        // ✅ إصلاح: adminAuth.listUsers(1000) يرجّع صفحة واحدة فقط (حد أقصى
        // 1000 مستخدم) بدون أي pagination — أي متجر يتجاوز 1000 مستخدم مسجَّل
        // كان سيرى "إجمالي العملاء" متجمّداً بصمت تام عند حد الصفحة الأولى
        // (١٠٠٠ أو أقل بقليل) للأبد، بدون أي خطأ ظاهر. الآن نستمر بجلب كل
        // الصفحات عبر pageToken حتى نهاية القائمة الفعلية.
        let totalUsers = 0;
        let pageToken: string | undefined;
        do {
          const listUsersResult = await adminAuth.listUsers(1000, pageToken);
          totalUsers += listUsersResult.users.length;
          pageToken = listUsersResult.pageToken;
        } while (pageToken);
        totalCustomers = totalUsers;
      } catch (e) {
        const usersSnapshot = await adminDb.collection("users").get();
        totalCustomers = usersSnapshot.size;
      }

      return {
        totalProducts: productsSnapshot.size,
        totalOrders: ordersSnapshot.size,
        totalCategories: categoriesCountSnapshot.data().count,
        totalCustomers,
        totalRevenue,
        pendingOrders,
        completedOrders,
        lowStockProducts,
        topProducts,
        lowStockThreshold,
      };
    }),

  // --- الإشعارات (v2) ---
  // مصدر الحقيقة الوحيد: users/{uid}/notifications (يقرأها الموقع والتطبيق
  // بنفس المسار عبر real-time listener، لا عبر polling). ⚠️ لا تعديل هنا
  // على users/{uid}.notifUnreadCount إطلاقاً — تسويته تتم حصراً بواسطة
  // Cloud Function واحدة (functions/src/triggers/notificationCounterTrigger.ts)
  // تلاحظ كل كتابة على أي مستند إشعار بصرف النظر عن مصدرها (هذه الطفرات
  // بالتحديد، أو كتابة مباشرة من تطبيق الأندرويد)، فيبقى العدّاد صحيحاً
  // ومتّسقاً من نقطة واحدة فقط بدل تكرار منطق الزيادة/الإنقاص بكل دالة.
  markNotificationRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = adminDb.collection("users").doc(ctx.user.id).collection("notifications").doc(input.id);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "الإشعار غير موجود" });
      }
      await ref.update({ isRead: true, readAt: admin.firestore.Timestamp.now() });
      return { success: true };
    }),

  markAllNotificationsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const snapshot = await adminDb
        .collection("users").doc(userId).collection("notifications")
        .where("isRead", "==", false)
        .get();
      if (snapshot.empty) return { success: true };
      const now = admin.firestore.Timestamp.now();
      const batch = adminDb.batch();
      snapshot.docs.forEach(doc => batch.update(doc.ref, { isRead: true, readAt: now }));
      await batch.commit();
      return { success: true };
    }),

  deleteNotification: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = adminDb.collection("users").doc(ctx.user.id).collection("notifications").doc(input.id);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "الإشعار غير موجود" });
      }
      await ref.delete();
      return { success: true };
    }),

  // حذف كل إشعارات المستخدم دفعة واحدة (زر "حذف الكل" بصفحة الإشعارات).
  deleteAllNotifications: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const snapshot = await adminDb
        .collection("users").doc(userId).collection("notifications")
        .get();
      if (snapshot.empty) return { success: true, count: 0 };
      const batch = adminDb.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      return { success: true, count: snapshot.size };
    }),

  // --- التحقق من الطلب عبر QR ---
  verifyOrder: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input, ctx }) => {
      // ✅ إصلاح (Audit المرحلة 3، بند 3.5): إجراء عام (بلا تسجيل دخول) يبحث
      // برمز تحقق — بدون حد، يمكن تجربة عدد كبير من الرموز آلياً من نفس
      // العنوان بحثاً عن رمز صالح فعلي (verificationToken عشوائي 24-byte، لكن
      // منع المحاولات المتكررة طبقة دفاع إضافية رخيصة). 60 محاولة كل 5 دقائق
      // لكل IP تكفي لمسح رمز QR فعلي عدة مرات بالخطأ دون أي إزعاج للمستخدم الحقيقي.
      if (!checkRateLimit(`verify-order:${clientKey(ctx.req)}`, 60, 5 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "محاولات كثيرة جداً، حاول لاحقاً" });
      }
      const snapshot = await adminDb.collection("orders")
        .where("verificationToken", "==", input.token)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return { success: false, message: "الطلب غير موجود أو الرمز غير صحيح" };
      }
      
      const doc = snapshot.docs[0];
      const data = doc.data();
      
      return {
        success: true,
        order: {
          id: doc.id,
          orderNumber: data.orderNumber,
          status: data.status,
          total: data.total,
          customerName: data.shippingAddress?.fullName || data.shippingAddress?.name,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date(data.createdAt).toISOString(),
          items: data.items,
        }
      };
    }),
});
