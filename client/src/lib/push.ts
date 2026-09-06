import { getMessaging, getToken, onMessage, isSupported, type Messaging } from "firebase/messaging";
import { firebaseApp } from "./firebase";

/**
 * ELEVEN STORE — Web Push (إعادة بناء كاملة)
 * ─────────────────────────────────────────────────────────
 * وحدة مستقلة تماماً عن lib/firebase.ts، مسؤولة فقط عن دورة حياة إشعارات
 * الـPush على المتصفح: تسجيل service worker، طلب الإذن، الحصول على توكن FCM
 * وتحديثه، والاستماع للرسائل الواردة والموقع مفتوح بالمقدمة.
 *
 * قيود تقنية لا بد من احترامها هنا:
 * - Firebase Messaging غير مدعوم على كل المتصفحات (WebViews داخل تطبيقات،
 *   بعض متصفحات الأندرويد، Safari بأوضاع معينة) — لذا التهيئة كسولة (lazy)
 *   ومحمية بـ isSupported()، ولا نرمي أبداً خطأً غير مُمسوك لزائر على متصفح
 *   غير مدعوم.
 * - طلب الإذن (Notification.requestPermission) لا يُستدعى تلقائياً عند تحميل
 *   الصفحة أو تسجيل الدخول: أغلب المتصفحات تتجاهل الطلبات غير المرتبطة
 *   بضغطة مستخدم مباشرة (quiet permission UI) فيبقى الإذن "default" للأبد.
 *   الاستدعاء الفعلي يجب أن يأتي من زر صريح يضغطه المستخدم.
 */

const FCM_VAPID_KEY =
  import.meta.env.VITE_FCM_VAPID_KEY ||
  "BOx1ydjk5Cv9pIzuACGmP4on1cBPaa9stLtOzJNNoq2akYpCvSYrqAdXt-SwoCoTOrrCHrbp2t9AcFhFj1wSdRI";

const SERVICE_WORKER_URL = "/firebase-messaging-sw.js";

let messaging: Messaging | null = null;
let initPromise: Promise<void> | null = null;

function ensureMessagingInitialized(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!initPromise) {
    initPromise = isSupported()
      .then((supported) => {
        if (supported) messaging = getMessaging(firebaseApp);
      })
      .catch(() => {
        messaging = null;
      });
  }
  return initPromise;
}

export type PushPermissionState = NotificationPermission | "unsupported";

export function getCurrentPermissionState(): PushPermissionState {
  return typeof Notification !== "undefined" ? Notification.permission : "unsupported";
}

/**
 * تسجيل Service Worker فقط (بدون طلب إذن أو الحصول على توكن)
 * يُستدعى فور تحميل التطبيق لتجهيز الـ SW لاستقبال الإشعارات.
 */
export async function registerServiceWorkerOnly(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    console.log("[Push] Service Worker registered successfully");
    return true;
  } catch (error) {
    console.error("[Push] Service Worker registration failed:", error);
    return false;
  }
}

/**
 * يطلب إذن الإشعارات من المستخدم (إن لم يكن قد رفضه/منحه مسبقاً)، يسجّل
 * service worker، ويحفظ توكن FCM الناتج بقاعدة البيانات عبر الـmutation
 * الممرَّرة. يجب استدعاؤها مباشرة من معالج ضغطة زر (user gesture).
 *
 * ⚠️ يُنتظَر (await) حفظ التوكن فعلياً بالسيرفر قبل اعتبار العملية ناجحة —
 * إن فشل الحفظ (مثال: كوكي الجلسة لم تتأكد بعد بالسيرفر خلال أول لحظات
 * تسجيل الدخول) يُعاد "save-failed" صراحة بدل افتراض النجاح لمجرد الحصول
 * على توكن FCM من المتصفح. توكن لم يُحفظ = لن يصل أي Push إطلاقاً لاحقاً،
 * بصمت تام، رغم أن المستخدم منح الإذن فعلياً.
 */
export async function enablePushNotifications(
  updateFcmTokenMutation: { mutateAsync: (input: { token: string }) => Promise<unknown> }
): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "unsupported-browser" };
  }
  if (typeof Notification === "undefined") {
    return { ok: false, reason: "unsupported-browser" };
  }

  await ensureMessagingInitialized();
  if (!messaging) return { ok: false, reason: "unsupported-browser" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
    }

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    await navigator.serviceWorker.ready;

    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return { ok: false, reason: "no-token" };

    try {
      await updateFcmTokenMutation.mutateAsync({ token });
    } catch (saveError) {
      console.error("[Push] تعذّر حفظ توكن الإشعارات بالسيرفر:", saveError);
      return { ok: false, reason: "save-failed" };
    }

    return { ok: true };
  } catch (error) {
    console.error("[Push] فشل تفعيل الإشعارات:", error);
    return { ok: false, reason: "error" };
  }
}

/**
 * محاولة تفعيل الإشعارات مع إعادة محاولة تلقائية عند فشل الحفظ
 * (مثل: عدم جاهزية الجلسة، أو فشل مؤقت في الشبكة)
 */
export async function enablePushNotificationsWithRetry(
  updateFcmTokenMutation: { mutateAsync: (input: { token: string }) => Promise<unknown> },
  maxRetries = 3,
  delayMs = 2000
): Promise<{ ok: boolean; reason?: string }> {
  let attempt = 0;
  while (attempt < maxRetries) {
    const result = await enablePushNotifications(updateFcmTokenMutation);
    if (result.ok) return result;
    // الأخطاء التي لا يمكن حلها بإعادة المحاولة
    if (result.reason === "denied" || result.reason === "unsupported-browser") {
      return result;
    }
    attempt++;
    if (attempt < maxRetries) {
      console.warn(`[Push] إعادة محاولة ${attempt}/${maxRetries} بعد ${delayMs * attempt}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  return { ok: false, reason: "max-retries-exceeded" };
}

/**
 * تُستخدم فقط عند تسجيل الخروج للحصول على توكن *هذا الجهاز* الحالي حتى يمكن
 * حذفه تحديداً قبل signOut. لا تطلب إذناً جديداً ولا تُسجّل service worker
 * جديداً إن لم يكن مسجَّلاً أصلاً.
 */
export async function getCurrentDeviceToken(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;

  try {
    await ensureMessagingInitialized();
    if (!messaging) return null;

    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return null;

    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch {
    return null;
  }
}

export type ForegroundPushPayload = {
  title: string;
  body: string;
  type: string;
  actionRoute?: string;
  // معرّف الحدث الحتمي القادم من السيرفر (sha1(dedupeKey)) — لازم لبناء tag
  // مستقر لكل حدث تحديداً بدل تجميع كل إشعارات نفس النوع تحت tag واحد،
  // راجع الشرح بجانب استخدامها في App.tsx.
  notificationId?: string;
};

/**
 * استماع مستمر (طوال الجلسة) للرسائل الواردة أثناء فتح الموقع بالمقدمة.
 * يُعيد دالة إلغاء الاشتراك. آمنة على المتصفحات غير المدعومة.
 */
export function listenForegroundPush(callback: (payload: ForegroundPushPayload) => void): () => void {
  let cancelled = false;
  let unsubscribeFn: (() => void) | null = null;

  ensureMessagingInitialized().then(() => {
    if (cancelled || !messaging) return;
    unsubscribeFn = onMessage(messaging, (payload) => {
      const data = payload.data || {};
      callback({
        title: data.title || "إشعار جديد",
        body: data.body || "",
        type: data.type || "general",
        actionRoute: data.actionRoute || undefined,
        notificationId: data.notificationId || undefined,
      });
    });
  });

  return () => {
    cancelled = true;
    if (unsubscribeFn) unsubscribeFn();
  };
}