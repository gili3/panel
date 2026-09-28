// ELEVEN STORE — راوتر لوحة التحكم لمناطق التوصيل (CRUD) + خريطة الطلبات (صلاحية "deliveryMap")
// ─────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { adminDb } from "./firebase-admin";
import { router, adminPermission } from "./_core/trpc";
import { getDeliveryZones, saveDeliveryZones } from "./delivery-zone-service";
import { toIsoStringSafe } from "./date-utils";

const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const zoneInputSchema = z.object({
  name: z.string().min(1),
  // ✅ حلقة مضلّع مفتوحة، بحد أدنى 3 نقاط لتشكيل مساحة فعلية
  polygon: z.array(latLngSchema).min(3),
  isActive: z.boolean().default(true),
});

// الحالات التي تُعتبر "نشطة" لعرضها على خريطة الطلبات المجمّعة — بعد التسليم
// أو الإلغاء أو فشل الدفع لم يعد الطلب بحاجة لمتابعة موقعه على الخريطة.
// ✅ إعادة تنظيم: تحديث القيم لتطابق حالة الطلب الموحّدة الجديدة (status
// واحد بدل status+paymentStatus) — راجع shared/types.ts::OrderStatus.
const ACTIVE_ORDER_STATUSES = ["under_review", "processing", "out_for_delivery"] as const;

// الحالات التي يحق لصاحب صلاحية الخريطة (الموصّل) نقل الطلب إليها. الإلغاء/فشل
// الدفع مستبعدان عمداً: يُرجعان المخزون ويخصّان صلاحية "orders" (صفحة الطلبات).
const MAP_ALLOWED_STATUSES = ["processing", "out_for_delivery", "delivered"] as const;

export const deliveryZoneRouter = router({
  // --- مناطق التوصيل: CRUD كامل، محمي بصلاحية "deliveryZones" ---
  getZones: adminPermission("deliveryZones").query(async () => {
    return getDeliveryZones();
  }),

  createZone: adminPermission("deliveryZones")
    .input(zoneInputSchema)
    .mutation(async ({ input }) => {
      const zones = await getDeliveryZones();
      const newZone = { id: randomUUID(), ...input };
      await saveDeliveryZones([...zones, newZone]);
      return newZone;
    }),

  updateZone: adminPermission("deliveryZones")
    .input(zoneInputSchema.extend({ id: z.string() }))
    .mutation(async ({ input }) => {
      const zones = await getDeliveryZones();
      const idx = zones.findIndex(z => z.id === input.id);
      if (idx === -1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "المنطقة غير موجودة" });
      }
      const updated = [...zones];
      updated[idx] = { id: input.id, name: input.name, polygon: input.polygon, isActive: input.isActive };
      await saveDeliveryZones(updated);
      return updated[idx];
    }),

  deleteZone: adminPermission("deliveryZones")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const zones = await getDeliveryZones();
      await saveDeliveryZones(zones.filter(z => z.id !== input.id));
      return { success: true };
    }),

  // --- خريطة الطلبات المجمّعة: كل الطلبات النشطة بإحداثياتها دفعة واحدة ---
  // ✅ صلاحية "orders" (وليس "deliveryZones") لأن هذه بيانات طلبات فعلياً،
  // يفترض أن يراها أي أدمن يملك صلاحية الطلبات أصلاً بصرف النظر عن كونه
  // يدير مناطق التوصيل أيضاً أو لا.
  getActiveOrderLocations: adminPermission("deliveryMap").query(async () => {
    const snap = await adminDb
      .collection("orders")
      .where("status", "in", [...ACTIVE_ORDER_STATUSES])
      .get();

    return snap.docs
      .map(doc => {
        const data = doc.data();
        const addr = data.shippingAddress;
        const lat = typeof addr?.latitude === "number" ? addr.latitude : null;
        const lng = typeof addr?.longitude === "number" ? addr.longitude : null;
        if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
        return {
          orderId: doc.id,
          orderNumber: data.orderNumber as string,
          status: data.status as string,
          total: data.total as number,
          customerName: addr?.fullName || addr?.name || "",
          phone: addr?.phone || "",
          city: addr?.city || "",
          createdAt: toIsoStringSafe(data.createdAt),
          lat,
          lng,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }),

  // --- تفاصيل طلب واحد كاملة (عناصر الطلب + العنوان) — تُستخدم عند الضغط
  // على دبوس بخريطة الطلبات المجمّعة لفتح تفاصيله مباشرة بلا تنقّل لصفحة
  // أخرى. نفس صلاحية "deliveryMap" أعلاه.
  getOrderDetailsAdmin: adminPermission("deliveryMap")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const doc = await adminDb.collection("orders").doc(input.id).get();
      if (!doc.exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
      }
      const data = doc.data()!;
      return {
        id: doc.id,
        orderNumber: data.orderNumber as string,
        status: data.status as string,
        total: data.total as number,
        items: Array.isArray(data.items) ? data.items : [],
        shippingAddress: data.shippingAddress ?? null,
        createdAt: toIsoStringSafe(data.createdAt),
      };
    }),

  // --- تغيير حالة طلب من الخريطة (الموصّل). مقيَّد: الطلب يجب أن يكون نشطاً،
  // والحالة الجديدة من MAP_ALLOWED_STATUSES فقط. لا يمسّ المخزون، وإشعار العميل
  // يصله تلقائياً عبر Cloud Function (onOrderStatusChanged) عند تغيّر الحقل.
  updateOrderStatusFromMap: adminPermission("deliveryMap")
    .input(z.object({ id: z.string().min(1), status: z.enum(MAP_ALLOWED_STATUSES) }))
    .mutation(async ({ input }) => {
      const ref = adminDb.collection("orders").doc(input.id);
      await adminDb.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
        }
        const current = doc.data()!.status as string;
        if (!(ACTIVE_ORDER_STATUSES as readonly string[]).includes(current)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل حالة هذا الطلب من الخريطة" });
        }
        tx.update(ref, { status: input.status, updatedAt: new Date() });
      });
      return { success: true };
    }),
});
