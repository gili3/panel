import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import Layout from "@/components/Layout";
import AdminSidebar from "@/components/AdminSidebar";

interface AdminGuardProps {
  activeKey: string;
  children: (user: NonNullable<ReturnType<typeof useAuth>["user"]>) => ReactNode;
}

// يغلّف أي صفحة إدارية: يتحقق من الجلسة ثم من role === "admin"، ويعرض
// السايدبار (مفلترة حسب صلاحيات الأدمن الحالي) — منطق واحد بدل تكراره في كل
// صفحة (كان مكرراً 4 مرات داخل AdminDashboard.tsx وحدها).
export default function AdminGuard({ activeKey, children }: AdminGuardProps) {
  const { user, loading, roleLoading, logout } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login",
  });

  if (loading || roleLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <Layout>
        <div className="flex justify-center items-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <p className="text-muted-foreground text-center max-w-md">
              أنت لا تملك صلاحيات كافية للوصول إلى لوحة التحكم.
            </p>
            <Button variant="outline" onClick={() => logout()}>
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-8 flex flex-col md:flex-row gap-6">
        <AdminSidebar activeKey={activeKey} user={user} />
        <div className="flex-1 min-w-0">{children(user)}</div>
      </div>
    </Layout>
  );
}
