import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, ShieldAlert, Trash2, CheckCircle2, RotateCcw,
  LayoutDashboard, Server, Smartphone, ChevronDown,
} from "lucide-react";

type ErrorLogRow = {
  id: string;
  source: "panel" | "server" | "android";
  message: string;
  stack: string | null;
  route: string | null;
  userId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  deviceInfo: string | null;
  severity: "fatal" | "error" | "warning";
  count: number;
  resolved: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
};

const SOURCE_LABEL: Record<ErrorLogRow["source"], string> = {
  panel: "لوحة التحكم",
  server: "السيرفر",
  android: "تطبيق الأندرويد",
};

const SOURCE_ICON: Record<ErrorLogRow["source"], typeof LayoutDashboard> = {
  panel: LayoutDashboard,
  server: Server,
  android: Smartphone,
};

const SEVERITY_STYLE: Record<ErrorLogRow["severity"], string> = {
  fatal: "bg-destructive text-destructive-foreground",
  error: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/10 text-amber-700",
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ar-EG-u-nu-latn", { calendar: "gregory" }) : "-";
}

function ErrorLogsContent() {
  const utils = trpc.useUtils();
  const [sourceFilter, setSourceFilter] = useState<ErrorLogRow["source"] | "all">("all");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ErrorLogRow | null>(null);
  const [allItems, setAllItems] = useState<ErrorLogRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const { data, isLoading: isLoadingFirstPage } = trpc.errorLog.list.useQuery({
    source: sourceFilter === "all" ? undefined : sourceFilter,
    includeResolved,
    cursor: null,
  });

  // ✅ إعادة الجلب من الصفحة الأولى فقط عند تغيير الفلاتر — نفس نمط
  // ContactMessages.tsx (allItems محليّة متراكمة، تُعاد تهيئتها فقط عند
  // تغيّر مصدر البيانات نفسه، لا عند كل render).
  useEffect(() => {
    if (data) {
      setAllItems(data.items);
      setNextCursor(data.nextCursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const resetAndRefetch = () => {
    setAllItems(null);
    utils.errorLog.list.invalidate();
  };

  const loadMore = async () => {
    if (!nextCursor || isFetchingMore) return;
    setIsFetchingMore(true);
    try {
      const page = await utils.errorLog.list.fetch({
        source: sourceFilter === "all" ? undefined : sourceFilter,
        includeResolved,
        cursor: nextCursor,
      });
      setAllItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err: any) {
      toast.error(err?.message || "تعذّر تحميل المزيد");
    } finally {
      setIsFetchingMore(false);
    }
  };

  const resolveMutation = trpc.errorLog.resolve.useMutation({
    onSuccess: resetAndRefetch,
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.errorLog.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف السجل");
      setDeleteTarget(null);
      resetAndRefetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const items = allItems ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" /> سجل أخطاء النظام
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "panel", "server", "android"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={sourceFilter === s ? "default" : "outline"}
                onClick={() => setSourceFilter(s)}
              >
                {s === "all" ? "الكل" : SOURCE_LABEL[s]}
              </Button>
            ))}
            <Button
              size="sm"
              variant={includeResolved ? "default" : "outline"}
              onClick={() => setIncludeResolved((v) => !v)}
            >
              {includeResolved ? "عرض المُعالَجة أيضاً" : "غير المُعالَجة فقط"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingFirstPage && allItems === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              لا توجد أخطاء مسجَّلة — كل شيء يعمل بسلام 🎉
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const SourceIcon = SOURCE_ICON[item.source];
                const isExpanded = expandedId === item.id;
                return (
                  <div key={item.id} className={`border rounded-lg ${item.resolved ? "opacity-60" : ""}`}>
                    <button
                      className="w-full text-right flex items-start gap-3 p-3 hover:bg-muted/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      aria-expanded={isExpanded}
                    >
                      <SourceIcon className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={SEVERITY_STYLE[item.severity]}>{item.severity}</Badge>
                          <Badge variant="outline">{SOURCE_LABEL[item.source]}</Badge>
                          {item.count > 1 && <Badge variant="secondary">تكرر {item.count} مرة</Badge>}
                          {item.resolved && (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                              معالَج
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium mt-1 truncate">{item.message}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          آخر ظهور: {formatDate(item.lastSeenAt)}
                          {item.route && ` · ${item.route}`}
                          {item.userEmail && ` · ${item.userEmail}`}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 mt-1 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-3">
                        {item.stack && (
                          <pre
                            className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap"
                            dir="ltr"
                          >
                            {item.stack}
                          </pre>
                        )}
                        <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                          <span>أول ظهور: {formatDate(item.createdAt)}</span>
                          {item.appVersion && <span>نسخة التطبيق: {item.appVersion}</span>}
                          {item.deviceInfo && <span>الجهاز: {item.deviceInfo}</span>}
                          {item.userId && <span>المستخدم: {item.userId}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolveMutation.isPending}
                            onClick={() => resolveMutation.mutate({ id: item.id, resolved: !item.resolved })}
                          >
                            {item.resolved ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 ml-1" /> إعادة فتح
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 ml-1" /> تعليم كمُعالَج
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2 className="w-3.5 h-3.5 ml-1" /> حذف
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" size="sm" disabled={isFetchingMore} onClick={loadMore}>
                    {isFetchingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحميل المزيد"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السجل نهائياً</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ErrorLogs() {
  return (
    <AdminGuard activeKey="errorLogs">
      {() => <ErrorLogsContent />}
    </AdminGuard>
  );
}
