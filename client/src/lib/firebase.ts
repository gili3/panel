import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

/**
 * ELEVEN STORE — تهيئة Firebase الأساسية (Auth / Firestore / Storage / App Check)
 * منطق الإشعارات (FCM/Push) منقول بالكامل إلى lib/push.ts — هذا الملف مسؤول
 * فقط عن تأسيس اتصال Firebase نفسه، لا عن أي ميزة محدّدة فوقه.
 */

// ✅ إصلاح: كانت كل قيمة من قيم firebaseConfig تحمل قيمة احتياطية حقيقية
// مكتوبة صراحة بالكود (تخص مشروع "queen-beauty-b811b"). أي بيئة نشر يُنسى
// فيها ضبط متغيرات البيئة كانت ستتصل "بصمت" بمشروع الإنتاج الفعلي دون أي
// تنبيه — قد يعدّل بيانات حقيقية بالخطأ من بيئة اختبار غير مقصودة. الآن:
// فشل فوري وواضح عند الإقلاع إن غاب أي متغير مطلوب (fail-fast) بدل اتصال صامت.
const REQUIRED_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !import.meta.env[key]);
if (missingKeys.length > 0) {
  throw new Error(
    `[Firebase] متغيرات البيئة التالية مفقودة ولا يمكن تشغيل التطبيق بدونها: ${missingKeys.join(", ")}. ` +
    `يرجى ضبطها في ملف .env أو بإعدادات بيئة النشر قبل المتابعة.`
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// ✅ نظام الإشعارات v2: getFirestore() الافتراضي كان يعطي ذاكرة تخزين مؤقت
// في الذاكرة فقط (memory-only) — أي أن قائمة الإشعارات وحالتها (مقروء/غير
// مقروء) كانتا تختفيان بمجرد انقطاع الاتصال فعلياً وتحتاجان اتصالاً حياً
// لأي قراءة أو تعديل، رغم أن "العمل عند انقطاع الإنترنت" أحد المتطلبات
// الصريحة. persistentLocalCache يخزّن نسخة كاملة بـIndexedDB بالمتصفح:
// onSnapshot يستمر بإرجاع آخر نسخة معروفة فوراً بدون اتصال، وأي markRead/
// delete تصدر بينما الجهاز غير متصل تُحفظ محلياً كـ"كتابة معلَّقة" وتُزامَن
// تلقائياً فور عودة الاتصال — بدون أي كود إضافي مطلوب منّا لإدارة طابور
// إعادة المحاولة يدوياً. persistentMultipleTabManager يمنع تضارب النسخة
// المخزَّنة إن فتح المستخدم الموقع بعدة تبويبات بنفس المتصفح في آن واحد.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(firebaseApp);
// ✅ يستخدمه Login.tsx لاستدعاء sendPasswordResetOtp/confirmPasswordResetOtp
// (رمز OTP بقالبنا الموحّد عبر Gmail) بدل sendPasswordResetEmail المباشرة
// من Firebase Auth SDK (التي ترسل رابطاً بقالب Firebase الافتراضي).
export const functions = getFunctions(firebaseApp);

// App Check (reCAPTCHA v3) — يُفعَّل فقط إن وُجد مفتاح حقيقي بمتغيرات البيئة.
// بدونه، يُتخطّى بأمان تماماً طالما "Enforce" غير مفعَّل بعد بـFirebase Console.
// ⚠️ إصلاح (حادثة إنفاذ App Check الحقيقية): كان هذا التحذير يظهر بـconsole.warn
// فقط في وضع التطوير (import.meta.env.DEV) — أي في بيئة الإنتاج الفعلية، إن
// نُسي ضبط هذا المتغير، كان يمر بصمت تام بلا أي أثر حتى بسجلات المتصفح، رغم
// أن هذا بالضبط ما تسبّب بتعطّل الإشعارات المباشرة فور تفعيل Enforce. الآن
// يظهر التحذير في كل البيئات (لا يعطّل التطبيق، فقط سجل واضح بالـconsole).
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.error("[App Check] فشلت التهيئة:", error);
  }
} else {
  console.warn(
    "[App Check] VITE_RECAPTCHA_SITE_KEY غير مضبوط — لن يعمل Firestore App Check لزوّار الموقع. " +
    "إن كان 'Enforce' مفعّلاً بـFirebase Console، ستفشل كل طلبات Firestore المباشرة من هذا الموقع " +
    "(الإشعارات المباشرة تحديداً — راجع components/SystemWarningsCenter.tsx)."
  );
}

if (import.meta.env.DEV) {
  console.log("🔥 Firebase Initialized for Project:", firebaseConfig.projectId);
}
