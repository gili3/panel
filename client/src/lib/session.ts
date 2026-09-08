/**
 * مزامنة كوكي الجلسة httpOnly مع السيرفر (fb_session)، بالإضافة لفلاغ محلي
 * متفائل (localStorage) يُستخدم فقط لتسريع أول عرض للواجهة بعد فتح الموقع —
 * بدل انتظار Firebase SDK بالكامل قبل ما نقرر نعرض حالة "مسجّل دخول" أم لا.
 *
 * ملاحظة مهمة: الفلاغ المحلي لا يُستخدم أبداً كمصدر حقيقة وحيد لمنح صلاحيات
 * أو عرض بيانات حساسة — فقط لتحسين الإحساس بالسرعة أثناء التحميل الأول.
 * السيرفر (عبر كوكي الجلسة أو Firebase مباشرة) هو دائماً المصدر النهائي.
 */

const AUTH_FLAG_KEY = "store:auth-flag";

export function getCachedAuthFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTH_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCachedAuthFlag(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(AUTH_FLAG_KEY, "1");
    else window.localStorage.removeItem(AUTH_FLAG_KEY);
  } catch {
    // localStorage غير متاح (وضع خاص/متصفح مقيّد) — تجاهل بأمان
  }
}

// دمج الطلبات المتزامنة: عدة مكوّنات تستدعي useAuth في نفس اللحظة قد تحاول
// كلها إنشاء الجلسة معاً بعد أول تسجيل دخول — نضمن طلب شبكة واحد فقط فعلياً.
let inFlightLogin: Promise<void> | null = null;

export function establishServerSession(idToken: string): Promise<void> {
  if (inFlightLogin) return inFlightLogin;

  inFlightLogin = fetch("/api/session/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ idToken }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`session/login failed: ${res.status}`);
      setCachedAuthFlag(true);
    })
    .finally(() => {
      inFlightLogin = null;
    });

  return inFlightLogin;
}

export async function clearServerSession(): Promise<void> {
  try {
    await fetch("/api/session/logout", { method: "POST", credentials: "include" });
  } catch {
    // لا داعي لإيقاف تسجيل الخروج المحلي بسبب فشل شبكي هنا
  } finally {
    setCachedAuthFlag(false);
  }
}

export type WhoAmIUser = {
  id: string;
  openId: string;
  email?: string;
  name?: string;
  role: "admin" | "user";
  isSuperAdmin: boolean;
  permissions: string[];
} | null;

/**
 * تحقق سريع من حالة الدخول عبر كوكي الجلسة مباشرة، بالتوازي مع تهيئة
 * Firebase SDK وليس بعد انتظارها. أسرع بكثير عادةً من استعادة جلسة Firebase
 * محلياً، خصوصاً عند أول تحميل أو على شبكات بطيئة.
 */
export async function fetchWhoAmI(): Promise<WhoAmIUser> {
  try {
    const res = await fetch("/api/session/whoami", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return null;
  }
}
