import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { useEffect } from "react";
import { toast } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { AuthProvider, useAuth } from "./_core/hooks/useAuth";
import { registerServiceWorkerOnly, listenForegroundPush } from "./lib/push";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";
import Users from "./pages/Users";
import Notifications from "./pages/Notifications";
import ContactMessages from "./pages/ContactMessages";
import ErrorLogs from "./pages/ErrorLogs";
import DeliveryZones from "./pages/DeliveryZones";

// موقع لوحة التحكم مستقل تمامًا عن موقع العملاء: لا صفحات تسوّق هنا إطلاقاً.
// كل قسم إداري له رابط حقيقي خاص به الآن (/products، /orders، /users...).
function Router() {
  return (
    <Switch>
      <Route path={"/login"} component={Login} />
      <Route path={"/users"} component={Users} />
      <Route path={"/notifications"} component={Notifications} />
      <Route path={"/contact-messages"} component={ContactMessages} />
      <Route path={"/error-logs"} component={ErrorLogs} />
      <Route path={"/delivery-zones"} component={DeliveryZones} />
      <Route path={"/:section?"} component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

// ✅ جديد: يسجّل service worker فقط عند تحميل اللوحة (بلا طلب إذن — ذلك
// يبقى حصراً لزر "تفعيل" الصريح بـNotificationBell.tsx)، ثم يستمع لأي Push
// يصل والموقع مفتوح بالمقدمة تحديداً (onMessage لا onBackgroundMessage —
// الأخير من اختصاص service worker وحده). بدون هذا: أدمن فاتح تبويب اللوحة
// فعلاً لن يرى أي شيء لحدث وصل الآن سوى بعد الـpolling الدوري لـ20 ثانية
// بـNotificationBell.tsx، رغم وصول الـPush فعلياً للمتصفح في نفس اللحظة.
function PushNotificationsSetup() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    registerServiceWorkerOnly();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    return listenForegroundPush((payload) => {
      toast(payload.title, { description: payload.body });
    });
  }, [isAuthenticated]);

  return null;
}

// مؤشر حالة الاتصال بالشبكة فقط (بلا أي اعتماد على صفحات الموقع المحذوفة).
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
          <OfflineIndicator />
          <AuthProvider>
            <PushNotificationsSetup />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;
