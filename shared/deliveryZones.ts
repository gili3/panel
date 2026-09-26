// ELEVEN STORE — مناطق التوصيل (Delivery Zones)
// ─────────────────────────────────────────────────────────────────────────
// نوع المضلّع المشترك بين السيرفر ولوحة التحكم، ودالة التحقق الهندسي
// (نقطة داخل مضلّع) عبر خوارزمية Ray Casting القياسية — بلا أي مكتبة خارجية.
// تُخزَّن كل مناطق التوصيل في مستند واحد settings/deliveryZones لسهولة
// القراءة دفعة واحدة (مصفوفة مناطق) بدل مجموعة فرعية منفصلة لكل منطقة.

export type LatLng = { lat: number; lng: number };

export type DeliveryZone = {
  id: string;
  name: string;
  // ✅ حلقة مضلّع مفتوحة (لا حاجة لتكرار النقطة الأولى بالنهاية)، بحد أدنى 3 نقاط
  polygon: LatLng[];
  isActive: boolean;
};

/**
 * التحقق الهندسي: هل تقع نقطة (lat, lng) داخل مضلّع معطى؟
 * خوارزمية Ray Casting القياسية — تُطلق شعاعاً أفقياً من النقطة نحو اليمين
 * وتُحصي عدد تقاطعاته مع أضلاع المضلّع؛ عدد فردي = داخل، زوجي = خارج.
 */
export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** هل تقع النقطة داخل أي منطقة من مناطق التوصيل *الفعّالة*؟ */
export function isPointInAnyActiveZone(point: LatLng, zones: DeliveryZone[]): boolean {
  return zones.some(z => z.isActive && isPointInPolygon(point, z.polygon));
}

/** أصغر مستطيل إحداثيات (bounding box) يحيط بكل نقاط مضلّع واحد. */
export function polygonBoundingBox(polygon: LatLng[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

/**
 * أصغر مستطيل إحداثيات يحيط بكل مناطق التوصيل الفعّالة مجتمعة — يُستخدم
 * كخط دفاع ثانٍ تقريبي بـfirestore.rules (لا يمكن التعبير عن تقاطع مضلّع
 * حقيقي هناك)، بينما التحقق الدقيق الفعلي دائماً عبر isPointInAnyActiveZone
 * على السيرفر (Admin SDK يتجاوز firestore.rules أصلاً).
 */
export function activeZonesBoundingBox(zones: DeliveryZone[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const active = zones.filter(z => z.isActive && z.polygon.length >= 3);
  if (active.length === 0) return null;
  const boxes = active.map(z => polygonBoundingBox(z.polygon));
  return {
    minLat: Math.min(...boxes.map(b => b.minLat)),
    maxLat: Math.max(...boxes.map(b => b.maxLat)),
    minLng: Math.min(...boxes.map(b => b.minLng)),
    maxLng: Math.max(...boxes.map(b => b.maxLng)),
  };
}

export function isValidLatLng(v: unknown): v is LatLng {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as any).lat === "number" && typeof (v as any).lng === "number" &&
    Math.abs((v as any).lat) <= 90 && Math.abs((v as any).lng) <= 180
  );
}
