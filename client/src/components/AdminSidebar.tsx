import { Link } from "wouter";
import { ADMIN_SECTIONS, userHasAdminPermission } from "@/lib/adminSections";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeKey: string;
  user: { isSuperAdmin?: boolean; permissions?: string[] } | null | undefined;
}

// شريط تنقّل جانبي بسيط — يعرض فقط الأقسام التي يملك الأدمن الحالي صلاحية
// الوصول لها (السوبر أدمن يرى الكل دائماً).
export default function AdminSidebar({ activeKey, user }: AdminSidebarProps) {
  const visibleSections = ADMIN_SECTIONS.filter((s) => userHasAdminPermission(user, s.permission));

  return (
    <nav className="w-full md:w-56 md:shrink-0 md:border-l md:pl-4">
      <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
        {visibleSections.map((section) => {
          const Icon = section.icon;
          const isActive = section.key === activeKey;
          return (
            <Link key={section.key} href={section.path}>
              <a
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent/10"
                )}
              >
                <Icon className="w-4 h-4" />
                {section.label}
              </a>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
