/**
 * ثيمات ألوان جاهزة لتبويب "المظهر" في إعدادات لوحة التحكم.
 * كل ثيم = 3 قيم (primary/secondary/background) تُطبَّق دفعة واحدة بضغطة
 * واحدة بدل اختيار كل لون يدوياً. القيم مُختارة يدوياً بحيث:
 *  - تبتعد عن ألوان حالة الطلب الثابتة (أخضر/أحمر/أزرق/برتقالي في
 *    ORDER_STATUS_COLORS بـ colors.ts) حتى لا يلتبس زر عادي بحالة طلب.
 *  - التباين بين primary وbackground قوي بما يكفي (raw ≥ 3:1) في كل ثيم.
 */
export interface ThemePreset {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  background: string;
}

export const PRESET_THEMES: ThemePreset[] = [
  { id: "default",  name: "الافتراضي (رمادي غامق)", primary: "#0F172A", secondary: "#F1F5F9", background: "#FFFFFF" },
  { id: "navy",     name: "كحلي",                    primary: "#0C4A6E", secondary: "#F0F9FF", background: "#FFFFFF" },
  { id: "royal",    name: "بنفسجي ملكي",             primary: "#6D28D9", secondary: "#F5F3FF", background: "#FFFFFF" },
  { id: "emerald",  name: "أخضر زمردي",              primary: "#065F46", secondary: "#ECFDF5", background: "#FFFFFF" },
  { id: "wine",     name: "عنابي",                    primary: "#9F1239", secondary: "#FFF1F2", background: "#FFFFFF" },
  { id: "amber",    name: "بني/كراميل",              primary: "#78350F", secondary: "#FFFBEB", background: "#FFFFFF" },
  { id: "teal",     name: "فيروزي داكن",             primary: "#115E59", secondary: "#F0FDFA", background: "#FFFFFF" },
  { id: "rose",     name: "وردي عصري",               primary: "#9D174D", secondary: "#FDF2F8", background: "#FFFFFF" },
  { id: "slateDark",name: "أسود دافئ (داكن بالكامل)", primary: "#F1F5F9", secondary: "#1E293B", background: "#0F172A" },
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** يحوّل Hex إلى سطوع نسبي (relative luminance) حسب معادلة WCAG. */
function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** نسبة تباين WCAG بين لونين (1 = لا فرق إطلاقاً، 21 = أقصى تباين ممكن). */
export function getContrastRatio(hexA: string, hexB: string): number | null {
  if (!HEX_RE.test(hexA) || !HEX_RE.test(hexB)) return null;
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** نفس منطق contrastingOnColor في Theme.kt (تطبيق الأندرويد) — أبيض أو
 *  حبر غامق فوق أي لون خلفية، حسب سطوعها، حتى تُطابق المعاينة هنا فعلياً
 *  ما سيظهر داخل التطبيق (نفس معادلة السطوع البسيطة المستخدمة هناك، وليست
 *  WCAG الكاملة المستخدمة في getContrastRatio أعلاه). */
export function getReadableTextColor(hex: string): string {
  if (!HEX_RE.test(hex)) return "#FFFFFF";
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? "#0F172A" : "#FFFFFF";
}
