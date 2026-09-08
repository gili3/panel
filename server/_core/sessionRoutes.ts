import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { simpleRateLimit } from "./rateLimit";
import { adminAuth, adminDb } from "../firebase-admin";
import {
  createSession,
  verifySession,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "./session";

// ✅ إصلاح (Audit المرحلة 3، بند 3.5): لا يوجد أي حد لعدد محاولات تبديل
// idToken بكوكي جلسة — يسمح نظرياً بمحاولات مكثفة متكررة. حد معقول: 20
// محاولة كل 15 دقيقة لكل IP (يكفي بسهولة لأي استخدام شرعي، حتى مع تبديل
// الشبكة أو محاولات فاشلة متكررة بسبب خطأ كلمة مرور بصفحة تسجيل الدخول).
const loginRateLimit = simpleRateLimit("session-login", 20, 15 * 60 * 1000);

// ✅ إصلاح: كانت هذه الدالة تتحقق فقط من OWNER_OPEN_ID، بعكس buildUser() في
// context.ts التي تتحقق أيضاً من حقل users/{uid}.role بـFirestore لدعم أدمنز
// متعددين. النتيجة: أي أدمن غير صاحب المتجر كان يظهر له "لا تملك صلاحيات
// كافية" لحظياً عبر المسار السريع (whoami) عند فتح اللوحة أو تحديث الصفحة،
// قبل أن يصل رد trpc.auth.me الصحيح ويصحّح الوضع — إرباك حقيقي لأي أدمن
// غير المالك رغم أن صلاحياته الفعلية سليمة عبر tRPC. الآن تقرأ نفس الحقل.
async function roleFor(uid: string): Promise<"admin" | "user"> {
  if (ENV.ownerOpenId && uid === ENV.ownerOpenId) return "admin";
  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    const data = snap.data();
    if (data?.role === "admin" && !data?.disabled) return "admin";
  } catch (error) {
    console.error("[Session] فشل قراءة دور المستخدم من Firestore (whoami):", error);
  }
  return "user";
}

// ✅ إصلاح حرج: الدور الإداري كان يُحسب فقط لحظياً هنا وبـcontext.ts (مقارنة
// uid مع OWNER_OPEN_ID)، ولا يُكتب أبداً كحقل فعلي على مستند users/{uid}
// بـFirestore. كل استخدام إداري عبر السيرفر (لوحة التحكم عبر tRPC) يعمل بلا
// مشكلة لأنه يتجاوز Firestore Rules أصلاً (Admin SDK)، لكن الرفع المباشر
// لصور المنتجات من نفس لوحة التحكم يمرّ عبر Storage Client SDK مباشرة (راجع
// lib/imageUpload.ts)، وقواعد Storage/Firestore الجديدة تتحقق من الدور عبر
// isAdmin() التي تقرأ هذا الحقل بالضبط من Firestore. بدون هذه الكتابة، كان
// isAdmin() سترجع false دائماً حتى لحساب المالك نفسه، فتفشل كل عمليات رفع
// الصور بمجرد تفعيل القواعد. الكتابة idempotent (merge) وتحدث تلقائياً في
// كل تسجيل دخول لصاحب الحساب — تصحّح نفسها ذاتياً حتى لو تغيّر OWNER_OPEN_ID
// مستقبلاً، بلا أي تدخّل يدوي بكونسول Firebase.
async function syncAdminRoleToFirestore(uid: string): Promise<void> {
  if (!ENV.ownerOpenId || uid !== ENV.ownerOpenId) return;
  try {
    await adminDb.collection("users").doc(uid).set({ role: "admin" }, { merge: true });
  } catch (error) {
    // ✅ إصلاح دفاعي: فشل مزامنة الدور لا يجب أن يُسقِط تسجيل الدخول نفسه —
    // المستخدم سيبقى "admin" فعلياً عبر tRPC (يعتمد على env لا على هذا الحقل)،
    // فقط رفع الصور المباشر عبر Storage سيبقى متأثراً حتى تُحل المشكلة.
    console.error("[Session] فشلت مزامنة role=admin بمستند Firestore:", error);
  }
}

export function registerSessionRoutes(app: Express) {
  // ✅ تُستدعى من الواجهة مرة واحدة مباشرة بعد أي تسجيل دخول/إنشاء حساب ناجح
  // عبر Firebase Auth بالمتصفح — تحوّل idToken المؤقت إلى كوكي جلسة httpOnly
  // طويل الأمد، فتصبح كل الطلبات القادمة (tRPC وغيرها) مصادَق عليها تلقائياً
  // من الكوكي دون أي حاجة لإرفاق هيدر Authorization يدوياً.
  app.post("/api/session/login", loginRateLimit, async (req: Request, res: Response) => {
    const idToken = req.body?.idToken;
    if (!idToken || typeof idToken !== "string") {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    try {
      const sessionCookie = await createSession(idToken);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
        ...cookieOptions,
        maxAge: SESSION_MAX_AGE_MS,
      });
      res.json({ success: true });

      // ✅ إصلاح: مزامنة role=admin بمستند Firestore عند كل تسجيل دخول لصاحب
      // الحساب (انظر شرح syncAdminRoleToFirestore أعلاه). تعمل بعد إرسال
      // الاستجابة للعميل (لا داعي لانتظارها) — idToken يحمل uid بلا حاجة
      // لفكّه يدوياً بما أن verifyIdToken تتحقق من صلاحيته وتُرجعه مباشرة.
      adminAuth.verifyIdToken(idToken)
        .then((decoded) => syncAdminRoleToFirestore(decoded.uid))
        .catch((error) => console.error("[Session] فشل التحقق من idToken لمزامنة الدور:", error));
    } catch (error) {
      console.error("[Session] فشل إنشاء كوكي الجلسة:", error);
      res.status(401).json({ error: "invalid idToken" });
    }
  });

  // تُستدعى عند تسجيل الخروج لمسح كوكي الجلسة من طرف السيرفر أيضاً (وليس فقط
  // signOut المحلي في Firebase SDK بالمتصفح).
  app.post("/api/session/logout", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    res.json({ success: true });
  });

  // ✅ نقطة تحقق خفيفة وسريعة جداً (لا تحتاج Firestore ولا أي استعلام إضافي):
  // الواجهة تستدعيها فور الإقلاع بالتوازي مع تهيئة Firebase SDK — وليس بعد
  // انتظارها — عشان تعرف حالة الدخول والدور مباشرة من الكوكي.
  app.get("/api/session/whoami", async (req: Request, res: Response) => {
    const sessionCookie = readCookie(req, SESSION_COOKIE_NAME);
    if (!sessionCookie) {
      res.status(401).json({ user: null });
      return;
    }

    try {
      const decoded = await verifySession(sessionCookie);
      res.json({
        user: {
          id: decoded.uid,
          openId: decoded.uid,
          email: decoded.email,
          name: decoded.name,
          role: await roleFor(decoded.uid),
        },
      });
    } catch {
      // كوكي غير صالح/منتهي/مُلغى — نمسحه حتى لا يُرسَل بلا فائدة مع كل طلب
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
      res.status(401).json({ user: null });
    }
  });
}
