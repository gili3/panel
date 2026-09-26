// ELEVEN STORE — خدمة مناطق التوصيل (قراءة + تحقق) على السيرفر
// ─────────────────────────────────────────────────────────────────────────
import { adminDb } from "./firebase-admin";
import { TRPCError } from "@trpc/server";
import { isPointInAnyActiveZone, activeZonesBoundingBox, type DeliveryZone, type LatLng } from "@shared/deliveryZones";

const DELIVERY_ZONES_DOC = adminDb.collection("settings").doc("deliveryZones");

/** يقرأ كل مناطق التوصيل المخزَّنة (فعّالة وغير فعّالة) من settings/deliveryZones. */
export async function getDeliveryZones(): Promise<DeliveryZone[]> {
  const doc = await DELIVERY_ZONES_DOC.get();
  if (!doc.exists) return [];
  const zones = doc.data()?.zones;
  return Array.isArray(zones) ? (zones as DeliveryZone[]) : [];
}

// ✅ إلى جانب المضلّعات نفسها، نخزّن أيضاً مستطيل الإحداثيات المحيط بكل
// المناطق الفعّالة مجتمعة (bbox) — يقرأه firestore.rules مباشرة كخط دفاع
// تقريبي ثانٍ لمسار الأندرويد المباشر (Client SDK)، حيث لا يمكن التعبير عن
// تقاطع مضلّع حقيقي بلغة القواعد. يُعاد حسابه هنا في كل حفظ حتى يبقى
// متطابقاً دائماً مع المضلّعات الفعّالة الحالية.
export async function saveDeliveryZones(zones: DeliveryZone[]): Promise<void> {
  const bbox = activeZonesBoundingBox(zones);
  await DELIVERY_ZONES_DOC.set({ zones, bbox, updatedAt: new Date() }, { merge: true });
}

// ✅ إذا لم تُضبط أي مناطق توصيل بعد (المتجر لم يفعّل هذه الميزة أصلاً)، لا
// نرفض أي طلب — الميزة تبقى معطّلة فعلياً حتى يُنشئ الأدمن أول منطقة توصيل
// من لوحة التحكم. بمجرد وجود منطقة فعّالة واحدة على الأقل، يصبح التوصيل
// خارجها مرفوضاً.
export async function assertWithinDeliveryZone(location: LatLng | null | undefined): Promise<void> {
  const zones = await getDeliveryZones();
  const hasActiveZones = zones.some(z => z.isActive);
  if (!hasActiveZones) return;

  if (!location) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "يجب تحديد موقعك على الخريطة لإتمام الطلب — عنوانك خارج نطاق مناطق التوصيل المتاحة",
    });
  }

  if (!isPointInAnyActiveZone(location, zones)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "عذراً، موقع التوصيل الذي حدّدته يقع خارج مناطق التوصيل المعتمدة حالياً",
    });
  }
}
