// ELEVEN STORE — ثوابت خرائط Leaflet/OpenStreetMap المشتركة
// ─────────────────────────────────────────────────────────────────────────
// ✅ إعادة تنظيم: كانت هذه الثوابت معرَّفة محلياً داخل DeliveryZones.tsx فقط،
// ثم احتاجتها صفحة "خريطة التوصيل" المستقلة (DeliveryMap.tsx) أيضاً بعد فصل
// الخريطة عنها — الآن مصدر واحد يستوردانه معاً بدل تكرار نفس القيم في ملفين.

// افتراضي: مركز الخرطوم — نفس نقطة البداية المستخدمة بتطبيق الأندرويد (LocationPicker.kt)
export const KHARTOUM_CENTER: [number, number] = [15.5007, 32.5599];
export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
