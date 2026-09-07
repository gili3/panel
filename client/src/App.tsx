import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { useEffect } from "react";
import { toast } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { 
  registerServiceWorkerOnly, 
  enablePushNotificationsWithRetry, 
  getCurrentPermissionState, 
  listenForegroundPush 
} from "@/lib/push";
import { useNotifications, useNewNotificationWatcher } from "@/hooks/useNotifications";
import Home from "./pages/Home";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Cart from "./pages/Cart";
import Profile from "./pages/Profile";
import Favorites from "./pages/Favorites";
import Checkout from "./pages/Checkout";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import VerifyOrder from "./pages/VerifyOrder";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Terms from "./pages/Terms";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/products"} component={Products} />
      <Route path={"/product/:id"} component={ProductDetail} />
      <Route path={"/about"} component={About} />
      <Route path={"/contact"} component={Contact} />
      <Route path={"/cart"} component={Cart} />
      <Route path={"/profile"} component={Profile} />
      <Route path={"/favorites"} component={Favorites} />
      <Route path={"/checkout"} component={Checkout} />
      <Route path={"/admin"} component={AdminDashboard} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/orders"} component={Orders} />
      <Route path={"/order/:id"} component={OrderDetail} />
      <Route path={"/verify-order/:token"} component={VerifyOrder} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/notifications"} component={Notifications} />
      <Route path={"/privacy-policy"} component={PrivacyPolicy} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// يفعّل إشعارات الـPush على الموقع: يُحدّث توكن FCM بصمت لزائر منح الإذن
// مسبقاً، يعرض تنبيه Toast + إشعار نظام حقيقي فوري لأي إشعار جديد يصل (عبر
// مستمع Firestore اللحظي — نفس مصدر البيانات التي تعرضه صفحة الإشعارات
// وجرس الهيدر، فلا يوجد أي تأخير أو اعتماد على نجاح تسليم الـPush).
function NotificationsBridge() {
  const { user, sessionReady } = useAuth();
  const updateFcmToken = trpc.firestore.updateFcmToken.useMutation();
  const { notifications } = useNotifications();

  // ✅ تسجيل Service Worker فوراً (مرة واحدة عند تحميل التطبيق)
  useEffect(() => {
    registerServiceWorkerOnly();
  }, []);

  // ✅ مراقبة تغيير الإذن وحفظ التوكن تلقائياً عند توفر الجلسة
  useEffect(() => {
    if (!user?.id || !sessionReady) return;
    const permission = getCurrentPermissionState();
    if (permission === "granted") {
      enablePushNotificationsWithRetry(updateFcmToken)
        .then((result) => {
          if (result.ok) {
            console.log("[Push] تم تفعيل الإشعارات بنجاح");
          } else {
            console.warn("[Push] فشل تفعيل الإشعارات:", result.reason);
          }
        });
    }
  }, [user?.id, sessionReady, updateFcmToken]);

  // إشعار نظام حقيقي إضافي عند وصول Push والموقع بالمقدمة — يماثل سلوك
  // تطبيق الأندرويد الذي يعرض إشعار نظام دائماً بصرف النظر عن حالة التطبيق.
  useEffect(() => {
    return listenForegroundPush((payload) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      // ✅ إصلاح: كان الـtag مبنياً من "type" فقط (`eleven-store-order` مثلاً)،
      // فأي إشعارين متتاليين من نفس النوع (استلام الطلب ثم لاحقاً تغيّر
      // الحالة) كانا يتشاركان نفس الـtag ويستبدل أحدهما الآخر صامتاً قبل أن
      // يراهما المستخدم — نفس العلّة المُصلَحة سابقاً بـfirebase-messaging-sw.js
      // لكنها كانت لا تزال قائمة هنا بمسار "المقدمة" فقط. الآن نستخدم
      // notificationId (معرّف حتمي فريد لكل حدث تحديداً) بنفس منطق service
      // worker: تجميع فعلي فقط لإعادة تسليم *نفس* الحدث بالضبط من FCM.
      const tag = payload.notificationId || `eleven-store-${payload.type}-${Date.now()}`;
      const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
        body: payload.body,
        icon: "/notification-icon.png",
        badge: "/badge-icon.png",
        vibrate: [200, 100, 200],
        silent: false,
        tag,
        renotify: true,
        data: { actionRoute: payload.actionRoute || "/notifications" },
      };
      navigator.serviceWorker?.getRegistration()
        .then((reg) => (reg ? reg.showNotification(payload.title, options) : new Notification(payload.title, options)))
        .catch(() => {
          try {
            new Notification(payload.title, options);
          } catch {
            // المتصفح لا يدعم Notification API إطلاقاً — تجاهل بأمان
          }
        });
    });
  }, []);

  // تنبيه Toast فوري لأي إشعار جديد — مصدره Firestore مباشرة (لحظي)، لذا
  // يعمل حتى لو تعذّر تسليم الـPush أو لم يُمنح إذن الإشعارات بعد.
  useNewNotificationWatcher(notifications, (n) => {
    toast(n.title, { description: n.body });
  });

  return null;
}

// ✅ إصلاح (Audit المرحلة 9، التخزين المؤقت والعمل دون اتصال): لم يكن هناك
// أي وعي بحالة الاتصال بالشبكة إطلاقاً بكامل التطبيق — عند انقطاع الإنترنت،
// كل صفحة تعرض فقط رسالة الخطأ الافتراضية الخاصة بها (إن وُجدت) بلا أي
// إشارة موحّدة وواضحة لسبب المشكلة الحقيقي، ولا أي تنبيه عند عودة الاتصال
// لإعادة تحميل البيانات. ملاحظة مهمة: هذا **مؤشر حالة فقط**، وليس دعم عمل
// حقيقي دون اتصال (offline-first caching) — ذلك قرار معماري أكبر (يحتاج
// Service Worker مخصص للتخزين المؤقت + IndexedDB) لم يُنفَّذ لتجنّب مخاطرة
// عرض بيانات قديمة (أسعار/مخزون) للمستخدم بصمت دون علمه.
function OfflineIndicator() {
  useEffect(() => {
    const TOAST_ID = "offline-indicator";
    const handleOffline = () => {
      toast.error("لا يوجد اتصال بالإنترنت", {
        id: TOAST_ID,
        duration: Infinity,
        description: "بعض الميزات لن تعمل حتى تعود للاتصال بالشبكة.",
      });
    };
    const handleOnline = () => {
      toast.success("تم استعادة الاتصال بالإنترنت", { id: TOAST_ID, duration: 3000 });
    };
    if (!navigator.onLine) handleOffline();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
      <ThemeProvider defaultTheme="light" switchable={true}>
        <TooltipProvider>
          <Toaster />
          <NotificationsBridge />
          <OfflineIndicator />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;