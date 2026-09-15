import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Mail, CheckCircle2, Trash2, MessageSquareText } from "lucide-react";

type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  userId: string | null;
  status: "new" | "handled";
  createdAt: string | null;
};

function ContactMessagesContent() {
  const utils = trpc.useUtils();
  const [openMessage, setOpenMessage] = useState<ContactMessageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactMessageRow | null>(null);

  const { data, isLoading } = trpc.adminContact.list.useQuery();

  const setStatus = trpc.adminContact.setStatus.useMutation({
    onSuccess: () => {
      utils.adminContact.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "تعذّر تحديث الحالة"),
  });

  const deleteMessage = trpc.adminContact.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الرسالة");
      utils.adminContact.list.invalidate();
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message || "تعذّر حذف الرسالة"),
  });

  const rows = (data ?? []) as ContactMessageRow[];
  const newCount = rows.filter((r) => r.status === "new").length;

  const handleOpen = (row: ContactMessageRow) => {
    setOpenMessage(row);
    // ✅ فتح الرسالة يحدّدها "تمت معالجتها" تلقائياً — نفس منطق قراءة
    // الإشعارات بالتطبيق، بدل الاعتماد على زر منفصل يُنسى غالباً.
    if (row.status === "new") {
      setStatus.mutate({ id: row.id, status: "handled" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          رسائل التواصل
          {newCount > 0 && <Badge variant="destructive">{newCount} جديدة</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : rows.length > 0 ? (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/40 transition-colors ${
                  row.status === "new" ? "border-primary/40 bg-primary/5" : ""
                }`}
                onClick={() => handleOpen(row)}
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <MessageSquareText className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{row.name || "بدون اسم"}</p>
                        {row.status === "new" && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{row.email}</p>
                      {row.subject && (
                        <p className="text-sm mt-1 truncate">{row.subject}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {row.createdAt
                        ? new Date(row.createdAt).toLocaleString("ar-EG-u-nu-latn", { calendar: "gregory" })
                        : "-"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(row);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">لا توجد رسائل تواصل بعد</div>
        )}
      </CardContent>

      {/* عرض تفاصيل الرسالة */}
      <Dialog open={!!openMessage} onOpenChange={(open) => !open && setOpenMessage(null)}>
        <DialogContent>
          {openMessage && (
            <>
              <DialogHeader>
                <DialogTitle>{openMessage.subject || "رسالة تواصل"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">الاسم:</span>
                  <span className="font-medium">{openMessage.name || "-"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">البريد:</span>
                  <a href={`mailto:${openMessage.email}`} className="font-medium text-primary underline">
                    {openMessage.email}
                  </a>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {openMessage.createdAt
                    ? new Date(openMessage.createdAt).toLocaleString("ar-EG-u-nu-latn", { calendar: "gregory" })
                    : "-"}
                </div>
                <div className="border rounded-lg p-3 bg-muted/30 whitespace-pre-wrap leading-relaxed">
                  {openMessage.message}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button asChild>
                  <a href={`mailto:${openMessage.email}?subject=${encodeURIComponent("رد: " + (openMessage.subject || ""))}`}>
                    <Mail className="w-4 h-4 ml-2" />
                    الرد عبر البريد
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف رسالة التواصل</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف رسالة "{deleteTarget?.name}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMessage.isPending}
              onClick={() => deleteTarget && deleteMessage.mutate({ id: deleteTarget.id })}
            >
              {deleteMessage.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* شارة "تمت المعالجة" ظاهرة فقط بحالة عدم التحميل، توضيح للحالة أسفل الجدول */}
      {!isLoading && rows.some((r) => r.status === "handled") && (
        <div className="px-6 pb-4 text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          الرسائل بخلفية بيضاء تمت معالجتها بالفعل
        </div>
      )}
    </Card>
  );
}

export default function ContactMessages() {
  return (
    <AdminGuard activeKey="contactMessages">
      {() => <ContactMessagesContent />}
    </AdminGuard>
  );
}
