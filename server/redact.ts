// ELEVEN STORE — إخفاء البيانات الحساسة من نصوص سجلات الأخطاء قبل تخزينها
// ─────────────────────────────────────────────────────────────────────────
// reportError (عام) يقبل message/stack/route/deviceInfo من أي عميل، وتُخزَّن كما هي
// بـsystemErrorLogs وتظهر بلوحة التحكم. رسائل أخطاء الشبكة تحوي أحياناً روابط بها
// token=... أو ترويسة Authorization أو JWT كاملاً أو توكن FCM؛ لا يجوز أن تصل نصاً
// مقروءاً لكل أدمن ولا أن تبقى بقاعدة البيانات. هذه الدالة نقية (بلا اعتماديات).
const SENSITIVE_KEYS =
  "token|access_token|id_token|idtoken|refresh_token|api[_-]?key|apikey|password|passwd|pwd|otp|secret|authorization|cookie|session|fb_session";

export function redactSensitive(input: string): string {
  if (!input) return input;
  return input
    // JWT كامل (ثلاثة مقاطع base64url)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[JWT]")
    // Authorization: Bearer xxx
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    // key=value / "key":"value" / key: value لمفاتيح حساسة معروفة
    .replace(
      new RegExp(`((?:${SENSITIVE_KEYS})["']?\\s*[=:]\\s*["']?)[^&\\s"',}]{3,}`, "gi"),
      "$1[REDACTED]",
    )
    // سلاسل طويلة متصلة (توكن FCM/كوكي جلسة/مفتاح) ≥ 80 محرفاً
    .replace(/[A-Za-z0-9_:-]{80,}/g, "[REDACTED-LONG]");
}

export function redactOptional(value: string | null | undefined): string | undefined {
  return value ? redactSensitive(value) : undefined;
}
