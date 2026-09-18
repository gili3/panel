import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dismissSystemWarning, useSystemWarnings } from "@/lib/systemWarnings";

/**
 * ELEVEN STORE — مركز تحذيرات النظام (لوحة التحكم)
 * ─────────────────────────────────────────────────────────
 * ✅ إضافة (بطلب الأدمن): مكان واحد مخصّص تظهر فيه كل تحذيرات النظام
 * التقنية (فشل App Check، انقطاع اتصال حي، وأي تحذير مستقبلي يُسجَّل عبر
 * lib/systemWarnings.ts) — بدل بانر مستقل لكل نوع عطل بأعلى كل صفحة.
 * هذه **ليست** إشعارات تجارية (تلك من NotificationBell: طلب جديد، رسالة
 * تواصل...) — هذه أعطال بالتطبيق نفسه يحتاج الأدمن معرفتها.
 * الأيقونة نفسها لا تظهر إطلاقاً إن لم يوجد أي تحذير نشط، فلا تُشغل مساحة
 * أو انتباه الأدمن بلا داعٍ.
 */
function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default function SystemWarningsCenter() {
  const warnings = useSystemWarnings();
  if (warnings.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`تحذيرات النظام (${warnings.length})`}
        >
          <ShieldAlert className="w-5 h-5 text-destructive" />
          <Badge
            variant="destructive"
            className="absolute -top-1 -left-1 h-5 min-w-5 px-1 flex items-center justify-center text-[10px]"
          >
            {warnings.length > 99 ? "99+" : warnings.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            تحذيرات النظام
          </span>
        </div>
        <ScrollArea className="max-h-96">
          {warnings.map((w) => (
            <div
              key={w.id}
              className={`flex gap-2 px-3 py-2.5 border-b last:border-b-0 ${
                w.severity === "error" ? "bg-destructive/5" : "bg-amber-500/5"
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  w.severity === "error" ? "text-destructive" : "text-amber-600"
                }`}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{w.title}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{w.message}</p>
                <span className="text-[11px] text-muted-foreground">{timeAgo(w.at)}</span>
              </div>
              {w.dismissible && (
                <button
                  onClick={() => dismissSystemWarning(w.id)}
                  className="text-muted-foreground hover:text-foreground self-start"
                  aria-label="إخفاء هذا التحذير"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
