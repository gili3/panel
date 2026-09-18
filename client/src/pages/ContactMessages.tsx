import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Mail, CheckCircle2, Trash2, MessageSquareText, Search, Send, Lock, LockOpen } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  userId: string | null;
  status: "new" | "handled";
  createdAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ar-EG-u-nu-latn", { calendar: "gregory" }) : "-";
}

function ContactMessagesContent() {
  const utils = trpc.useUtils();
  const { user: currentAdmin } = useAuth();
  const [openMessage, setOpenMessage] = useState<ContactMessageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactMessageRow | null>(null);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  // ✅ صفحات متراكمة محلياً (بدل الحد الصريح القديم "200 فقط") — كل صفحة
  // جديدة تُضاف لما قبلها، فلا شيء يختفي من اللوحة مهما تقادم.
  const [allItems, setAllItems] = useState<ContactMessageRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const { data, isLoading: isLoadingFirstPage } = trpc.adminContact.list.useQuery({ cursor: null });

  // أول تحميل (أو بعد أي إعادة ضبط بسبب تعديل/حذف/رد) — نُهيّئ القائمة
  // المتراكمة محلياً من نتيجة الصفحة الأولى فقط، مرة واحدة.
  useEffect(() => {
    if (data && allItems === null) {
      setAllItems(data.items);
      setNextCursor(data.nextCursor);
    }
  }, [data, allItems]);

  const resetPagination = () => {
    setAllItems(null);
    setNextCursor(null);
    utils.adminContact.list.invalidate();
  };

  const rows = useMemo(() => {
    const base = allItems ?? [];
    if (!search.trim()) return base;
    const q = search.trim().toLowerCase();
    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q)
    );
  }, [allItems, search]);

  const setStatus = trpc.adminContact.setStatus.useMutation({
    onSuccess: () => resetPagination(),
    onError: (err) => toast.error(err.message || "تعذّر تحديث الحالة"),
  });

  const deleteMessage = trpc.adminContact.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الرسالة");
      resetPagination();
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message || "تعذّر حذف الرسالة"),
  });

  const reply = trpc.adminContact.reply.useMutation({
    onSuccess: (result) => {
      toast.success(result.delivered ? "تم إرسال الرد داخل التطبيق" : "تم حفظ الرد (بلا حساب مرتبط لإرساله كإشعار)");
      resetPagination();
      setReplyText("");
      setOpenMessage(null);
    },
    onError: (err) => toast.error(err.message || "تعذّر إرسال الرد"),
  });

  const claim = trpc.adminContact.claim.useMutation({
    onSuccess: () => resetPagination(),
    onError: (err) => toast.error(err.message || "تعذّر حجز الرسالة"),
  });

  const unclaim = trpc.adminContact.unclaim.useMutation({
    onSuccess: () => resetPagination(),
    onError: (err) => toast.error(err.message || "تعذّر إلغاء الحجز"),
  });

  const newCount = rows.filter((r) => r.status === "new").length;

  const handleOpen = (row: ContactMessageRow) => {
    setOpenMessage(row);
    setReplyText("");
    // ✅ فتح الرسالة يحدّدها "تمت معالجتها" تلقائياً — نفس منطق قراءة
    // الإشعارات بالتطبيق، بدل الاعتماد على زر منفصل يُنسى غالباً.
    if (row.status === "new") {
      setStatus.mutate({ id: row.id, status: "handled" });
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor || isFetchingMore) return;
    setIsFetchingMore(true);
    try {
      const result = await utils.client.adminContact.list.query({ cursor: nextCursor });
      setAllItems((prev) => [...(prev ?? []), ...result.items]);
      setNextCursor(result.nextCursor);
    } finally {
      setIsFetchingMore(false);
    }
  };

  const hasMore = Boolean(nextCursor);
  const isLoading = isLoadingFirstPage && allItems === null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <CardTitle className="flex items-center gap-2">
          رسائل التواصل
          {newCount > 0 && <Badge variant="destructive">{newCount} جديدة</Badge>}
        </CardTitle>
        <div className="relative w-full max-w-xs">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="بحث في رسائل التواصل"
            placeholder="بحث بالاسم أو البريد أو النص..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
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
                        {row.reply && (
                          <Badge variant="outline" className="text-[10px]">تم الرد</Badge>
                        )}
                        {row.claimedBy && row.claimedBy !== currentAdmin?.uid && (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            {row.claimedByName || "محجوزة"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{row.email}</p>
                      {row.subject && (
                        <p className="text-sm mt-1 truncate">{row.subject}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</span>
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

            {!search && hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={isFetchingMore}>
                  {isFetchingMore ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
                  تحميل المزيد
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {search ? "لا توجد نتائج مطابقة" : "لا توجد رسائل تواصل بعد"}
          </div>
        )}
      </CardContent>

      {/* عرض تفاصيل الرسالة + الرد */}
      <Dialog open={!!openMessage} onOpenChange={(open) => !open && setOpenMessage(null)}>
        <DialogContent>
          {openMessage && (
            <>
              <DialogHeader>
                <DialogTitle>{openMessage.subject || "رسالة تواصل"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {/* ✅ جديد: حجز الرسالة قبل الرد — يمنع ردّ أدمنين على نفس
                    الرسالة بلا علم أحدهما بالآخر. */}
                {openMessage.claimedBy && openMessage.claimedBy !== currentAdmin?.uid ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                    <span className="flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" />
                      محجوزة بواسطة {openMessage.claimedByName || "أدمن آخر"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      disabled={unclaim.isPending}
                      onClick={() => unclaim.mutate({ id: openMessage.id })}
                    >
                      فكّ الحجز
                    </Button>
                  </div>
                ) : openMessage.claimedBy === currentAdmin?.uid ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" />
                      محجوزة لك
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      disabled={unclaim.isPending}
                      onClick={() => unclaim.mutate({ id: openMessage.id })}
                    >
                      فكّ الحجز
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={claim.isPending}
                    onClick={() => claim.mutate({ id: openMessage.id })}
                  >
                    <LockOpen className="w-3.5 h-3.5 ml-2" />
                    حجز الرسالة لي قبل الرد
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">الاسم:</span>
                  <span className="font-medium">{openMessage.name || "-"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">البريد:</span>
                  <a href={`mailto:${openMessage.email}`} className="font-medium text-primary underline">
                    {openMessage.email || "-"}
                  </a>
                </div>
                {!openMessage.userId && (
                  <p className="text-xs text-amber-600">
                    هذه الرسالة من زائر غير مسجّل دخول — الرد الوحيد الممكن هو بالبريد.
                  </p>
                )}
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {formatDate(openMessage.createdAt)}
                </div>
                <div className="border rounded-lg p-3 bg-muted/30 whitespace-pre-wrap leading-relaxed">
                  {openMessage.message}
                </div>

                {openMessage.reply && (
                  <div className="border border-primary/30 rounded-lg p-3 bg-primary/5">
                    <p className="text-xs text-muted-foreground mb-1">
                      ردّك السابق ({formatDate(openMessage.repliedAt)}):
                    </p>
                    <p className="whitespace-pre-wrap leading-relaxed">{openMessage.reply}</p>
                  </div>
                )}

                {/* ✅ جديد: رد داخل التطبيق (إشعار فوري للمستخدم) متاح فقط
                    لو الرسالة مرتبطة بحساب — بديل أوثق من mailto الذي يعتمد
                    على صحة إيميل الزائر. */}
                {openMessage.userId && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="اكتب رداً يصل للمستخدم كإشعار داخل التطبيق..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                    />
                    <Button
                      className="w-full"
                      disabled={!replyText.trim() || reply.isPending}
                      onClick={() =>
                        reply.mutate({ id: openMessage.id, message: replyText.trim() })
                      }
                    >
                      {reply.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
                      إرسال الرد داخل التطبيق
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <Button variant="outline" asChild>
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
