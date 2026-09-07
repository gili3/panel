import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { useEffect } from "react";
import { toast } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";

// موقع لوحة التحكم مستقل تمامًا عن موقع العملاء: لا صفحات تسوّق هنا إطلاقاً،
// فقط تسجيل الدخول والداشبورد نفسه (الذي يتحقق داخليًا من الجلسة ومن أن
// دور المستخدم "admin" قبل عرض أي بيانات).
function Router() {
  return (
    <Switch>
      <Route path={"/login"} component={Login} />
      <Route path={"/"} component={AdminDashboard} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;
