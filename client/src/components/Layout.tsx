import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, ShieldCheck } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

// شريط علوي بسيط خاص بلوحة التحكم (لا يحتوي أي روابط أو تنقّل خاص بموقع
// العملاء) — يظهر فقط بعد تسجيل الدخول، ويوفر زر تسجيل الخروج.
export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  return (
    <div className="flex flex-col min-h-screen bg-background" dir="rtl">
      {user && (
        <header className="sticky top-0 z-40 border-b bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>لوحة تحكم Eleven</span>
            </div>
            <div className="flex items-center gap-3">
              {user.email && (
                <span className="hidden sm:inline text-sm text-muted-foreground">{user.email}</span>
              )}
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 ml-1" />
                خروج
              </Button>
            </div>
          </div>
        </header>
      )}
      <main className="flex-1">{children}</main>
    </div>
  );
}
