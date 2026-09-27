/**
 * ELEVEN STORE — نظام الألوان الموحّد (Design Tokens) — نسخة "Design Rules"
 * ─────────────────────────────────────────────────────────────
 * هذا الملف هو المصدر الوحيد لكل ألوان الموقع.
 * أي مكوّن يحتاج لونًا بصيغة Hex خام (inline style, canvas, PDF/Invoice,
 * SVG) يجب أن يستورد القيمة من هنا بدلاً من كتابتها مباشرة.
 *
 * أما في className (Tailwind) فاستخدم أسماء الأصناف المرتبطة بمتغيرات
 * CSS المعرّفة في index.css (bg-primary, text-foreground, border-border...)
 * وهي مبنية على نفس القيم أدناه — لذا لا يوجد أي تكرار غير متزامن.
 *
 * القاعدة: 5 ألوان أساسية فقط — أسود/أبيض/رمادي للواجهة، وأخضر/أحمر/
 * أزرق/برتقالي محجوزة حصراً لحالات الطلب والتنبيهات. لا يوجد لون
 * "Accent" تجاري منفصل. النص الأساسي #0F172A، الثانوي #64748B فقط.
 *
 * يقابل هذا الملف في تطبيق الأندرويد:
 * apk/app/src/main/java/com/eleven/store/ui/theme/Theme.kt
 */

// ── الأساس ─────────────────────────────────────────────────────
export const INK = "#0F172A"; // Foreground / Primary
export const PURE_WHITE = "#FFFFFF"; // Background
export const TEXT_SECONDARY = "#64748B"; // النص الثانوي — الدرجة الوحيدة المسموحة

// ── تدرّج محايد (رمادي واحد فقط) ──────────────────────────────────
export const neutral = {
  50: "#F8FAFC",
  100: "#F1F5F9",
  200: "#E2E8F0",
  300: "#CBD5E1",
  400: "#94A3B8",
  500: "#64748B",
  600: "#475569",
  700: "#334155",
  800: "#1E293B",
  900: INK,
} as const;

// ── Primary = أسود/رمادي غامق فقط (لا لون علامة منفصل) ────────────
export const primary = {
  50: "#F8FAFC",
  100: "#F1F5F9",
  200: "#E2E8F0",
  300: "#CBD5E1",
  400: "#94A3B8",
  500: "#334155",
  600: "#1E293B",
  700: INK,
  800: INK,
  900: INK,
} as const;

// ── ألوان الحالة الأربعة — لحالات الطلب والتنبيهات فقط ─────────────
export const state = {
  green: "#22C55E",
  greenBg: "#DCFCE7",
  greenFg: "#166534",
  red: "#EF4444",
  redBg: "#FEE2E2",
  redFg: "#991B1B",
  blue: "#3B82F6",
  blueBg: "#DBEAFE",
  blueFg: "#1E3A8A",
  orange: "#F97316",
  orangeBg: "#FFEDD5",
  orangeFg: "#9A3412",
} as const;

// ── ألوان دلالية (تنبيهات/Toasts) ──────────────────────────────────
export const semantic = {
  success: state.green,
  successBg: state.greenBg,
  warning: state.orange,
  warningBg: state.orangeBg,
  destructive: state.red,
  destructiveBg: state.redBg,
  info: state.blue,
  infoBg: state.blueBg,
} as const;

// ── أدوار الواجهة — LIGHT (تطابق :root في index.css) ─────────────
export const light = {
  background: PURE_WHITE,
  foreground: INK,
  card: PURE_WHITE,
  cardForeground: INK,
  popover: PURE_WHITE,
  popoverForeground: INK,
  primary: INK,
  primaryForeground: PURE_WHITE,
  secondary: neutral[50],
  secondaryForeground: INK,
  muted: neutral[100],
  mutedForeground: TEXT_SECONDARY,
  accent: neutral[100], // تمييز محايد خفيف (Hover) — ليس لون علامة
  accentForeground: INK,
  destructive: semantic.destructive,
  destructiveForeground: PURE_WHITE,
  border: neutral[200],
  input: neutral[50],
  ring: neutral[400],
} as const;

// ── أدوار الواجهة — DARK (تطابق .dark في index.css) ──────────────
export const dark = {
  background: INK,
  foreground: "#F1F5F9",
  card: "#1E293B",
  cardForeground: "#F1F5F9",
  popover: "#1E293B",
  popoverForeground: "#F1F5F9",
  primary: "#E2E8F0",
  primaryForeground: INK,
  secondary: "#1E293B",
  secondaryForeground: "#F1F5F9",
  muted: "#1E293B",
  mutedForeground: neutral[400],
  accent: "#334155",
  accentForeground: "#F1F5F9",
  destructive: "#F87171",
  destructiveForeground: INK,
  border: "#334155",
  input: "#1E293B",
  ring: neutral[400],
} as const;

// ── ألوان حالات الطلب — قيم Hex ثابتة ومطلوبة حرفياً (لا تتغيّر مع
// الثيم الفاتح/الداكن، ولا تُبنى من tailwind classes) — هذه هي "مصدر
// الحقيقة الوحيد" لألوان حالة الطلب في كامل المشروع (الموقع، لوحة
// التحكم، وتطبيق الأندرويد عبر Theme.kt المطابق لها حرفياً).
// النظام: انتظار=رمادي / دفع=أخضر / توصيل=برتقالي / تسليم=أزرق / إلغاء=أحمر
export const ORDER_STATUS_COLORS = {
  pending:   { bg: "#475569", fg: "#FFFFFF" }, // قيد الانتظار — رمادي غامق
  paid:      { bg: "#16A34A", fg: "#FFFFFF" }, // تم الدفع — أخضر قوي
  shipped:   { bg: "#EA580C", fg: "#FFFFFF" }, // خرج للتوصيل — برتقالي قوي
  delivered: { bg: "#2563EB", fg: "#FFFFFF" }, // تم التسليم — أزرق قوي
  cancelled: { bg: "#DC2626", fg: "#FFFFFF" }, // ملغي — أحمر قوي
} as const;

export type OrderStatusKey = keyof typeof ORDER_STATUS_COLORS;

// ── ألوان حالات الدفع — منفصلة عمداً عن حالة الطلب أعلاه ──────────
// حالة الطلب (توصيل) وحالة الدفع مستقلتان تماماً (طلب "قيد الانتظار" قد
// يكون مدفوعاً مسبقاً أو لا) — لذا لكل منهما شارة لونية خاصة بدل دمجهما
// بنظام ألوان واحد قد يُلبس إحداهما بمعنى الأخرى.
// unpaid=رمادي فاتح / pending_review=برتقالي (بانتظار مراجعة الأدمن) /
// paid=أخضر / failed=أحمر.
export const PAYMENT_STATUS_COLORS = {
  unpaid:         { bg: "#E2E8F0", fg: "#334155" },
  pending_review: { bg: "#FFEDD5", fg: "#9A3412" },
  paid:           { bg: "#DCFCE7", fg: "#166534" },
  failed:         { bg: "#FEE2E2", fg: "#991B1B" },
} as const;

export type PaymentStatusKey = keyof typeof PAYMENT_STATUS_COLORS;

// ── تصدير مجمّع مريح للاستخدام في السياقات التي تحتاج Hex خام ────
export const COLORS = {
  ink: INK,
  white: PURE_WHITE,
  textSecondary: TEXT_SECONDARY,
  neutral,
  primary,
  state,
  semantic,
  light,
  dark,
} as const;

export default COLORS;
