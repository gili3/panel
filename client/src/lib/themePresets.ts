/**
 * ثيمات ألوان جاهزة لتبويب "المظهر" في إعدادات لوحة التحكم.
 *
 * كل ثيم = 6 قيم: Primary / Secondary / Background / Surface / Text / Accent
 * (نفس بنية Theme.kt في تطبيق الأندرويد). Primary/Secondary/Accent هي هوية
 * الثيم وتبقى كما هي في الوضع الداكن؛ Background/Surface/Text هي قيم الوضع
 * الفاتح فقط — نسخة الوضع الداكن منها تُشتق حسابياً (انظر deriveDarkTriplet)
 * بدل أن يُدخلها الأدمن يدوياً، حتى تبقى لوحة التحكم بسيطة (اختيار ثيم واحد
 * يكفي لتغطية الوضعين معاً).
 *
 * ألوان حالات الطلب والتنبيهات (نجاح/خطأ/تحذير/معلومة) ثابتة بتصميم النظام
 * ولا تتغير مع الثيم — راجع ORDER_STATUS_COLORS والحالات في colors.ts.
 */
export interface ThemePreset {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  /** الثيم المرشَّح كهوية أساسية لـ Eleven — يُعرض مميّزاً في القائمة. */
  recommended?: boolean;
}

export const PRESET_THEMES: ThemePreset[] = [
  { id: "emerald",   name: "🌿 زمردي (Emerald)",   primary: "#155E59", secondary: "#C4A57B", background: "#F8F6F1", surface: "#FFFFFF", text: "#17211F", accent: "#A67C52", recommended: true },
  { id: "champagne", name: "🥂 شمبانيا (Champagne)", primary: "#8A6A45", secondary: "#C4A57B", background: "#FAF7F2", surface: "#FFFFFF", text: "#2B2520", accent: "#A67C52" },
  { id: "rose",      name: "🌸 وردي (Rose)",        primary: "#9B5268", secondary: "#D9A6B5", background: "#FCF7F8", surface: "#FFFFFF", text: "#2D2226", accent: "#B86B83" },
  { id: "mocha",     name: "🤎 موكا (Mocha)",       primary: "#6B4F3A", secondary: "#B99A78", background: "#F7F3EE", surface: "#FFFFFF", text: "#29221D", accent: "#96704F" },
  { id: "plum",      name: "💜 بنفسجي (Plum)",      primary: "#63456F", secondary: "#B99BC5", background: "#F8F5FA", surface: "#FFFFFF", text: "#28212B", accent: "#89649A" },
  { id: "teal",      name: "🌊 فيروزي (Teal)",      primary: "#176B72", secondary: "#9CBDB8", background: "#F3F8F7", surface: "#FFFFFF", text: "#172628", accent: "#4D8589" },
];

/** حالات النظام — ثابتة ولا تتغير مع الثيم، حتى يظل التطبيق مفهوماً. */
export const SYSTEM_STATE_COLORS = {
  success: "#2E7D32",
  error: "#C62828",
  warning: "#EF6C00",
  info: "#1565C0",
} as const;

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

// ── اشتقاق ألوان الوضع الداكن من ألوان الوضع الفاتح ──────────────
// نفس الخوارزمية بالضبط مطبَّقة في Theme.kt (deriveDarkVariant) حتى تُطابق
// المعاينة هنا ما سيظهر فعلياً داخل تطبيق الأندرويد بالوضع الداكن.

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, tIn: number) => {
    let t = tIn;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** يشتق درجة أغمق/أفتح من لون معيّن مع الحفاظ على تدرّجه اللوني (Hue). */
function deriveVariant(hex: string, targetLightness: number, satScale = 1): string {
  if (!HEX_RE.test(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h, Math.min(1, s * satScale), targetLightness);
  return rgbToHex(nr, ng, nb);
}

/** يشتق ثلاثية (خلفية/سطح/نص) الوضع الداكن من ثلاثية الوضع الفاتح. */
export function deriveDarkTriplet(background: string, surface: string, text: string) {
  return {
    background: deriveVariant(background, 0.09, 0.55),
    surface: deriveVariant(surface || background, 0.15, 0.45),
    text: deriveVariant(text, 0.92, 0.25),
  };
}
