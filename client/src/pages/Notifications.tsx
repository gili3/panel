import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";

function NotificationsContent() {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | "user">("all");
  const [targetEmail, setTargetEmail] = useState("");
  const [actionRoute, setActionRoute] = useState("");

  const { data: foundUser, isFetching: isSearchingUser } = trpc.adminUsers.findUserByEmail.useQuery(
    { email: targetEmail },
    { enabled: target === "user" && targetEmail.length > 3 && targetEmail.includes("@") }
  );

  const { data: history, isLoading: isHistoryLoading } = trpc.adminNotifications.getHistory.useQuery();

  const sendNotification = trpc.adminNotifications.send.useMutation({
    onSuccess: (result) => {
      toast.success(
        target === "all"
          ? `جاري الإرسال لحوالي ${result.sentCount} مستخدم...`
          : `تم الإرسال بنجاح`
      );
      setTitle("");
      setBody("");
      setTargetEmail("");
      setActionRoute("");
      utils.adminNotifications.getHistory.invalidate();
    },
    onError: (err) => toast.error(err.message || "تعذّر إرسال الإشعار"),
  });

  const handleSend = () => {
    if (!title.trim() || !body.trim()) {
      toast.error("العنوان والنص مطلوبان");
      return;
    }
    if (target === "user" && !foundUser) {
      toast.error("لم يتم العثور على مستخدم بهذا البريد");
      return;
    }
    sendNotification.mutate({
      title: title.trim(),
      body: body.trim(),
      target,
      userId: target === "user" ? foundUser?.uid : undefined,
      actionRoute: actionRoute.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>إرسال إشعار جديد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">الجهة</label>
            <Select value={target} onValueChange={(v) => setTarget(v as "all" | "user")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستخدمين</SelectItem>
                <SelectItem value="user">مستخدم واحد</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {target === "user" && (
            <div>
              <label className="text-sm font-medium block mb-1.5">البريد الإلكتروني للمستخدم</label>
              <Input
                type="email"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                placeholder="example@email.com"
              />
              {isSearchingUser && <p className="text-xs text-muted-foreground mt-1">جاري البحث...</p>}
              {!isSearchingUser && targetEmail.includes("@") && !foundUser && (
                <p className="text-xs text-destructive mt-1">لم يتم العثور على مستخدم</p>
              )}
              {foundUser && (
                <p className="text-xs text-emerald-600 mt-1">تم العثور على: {foundUser.name || foundUser.email}</p>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium block mb-1.5">العنوان</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">النص</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={4} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">رابط عند الضغط (اختياري)</label>
            <Input value={actionRoute} onChange={(e) => setActionRoute(e.target.value)} placeholder="/orders" />
          </div>

          <Button onClick={handleSend} disabled={sendNotification.isPending} className="w-full sm:w-auto">
            {sendNotification.isPending ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 ml-2" />
            )}
            إرسال
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الإشعارات المرسلة</CardTitle>
        </CardHeader>
        <CardContent>
          {isHistoryLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>
          ) : (history?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {history!.map((item) => (
                <div key={item.id} className="border rounded-lg p-3">
                  <div className="flex justify-between items-start gap-2">
                    <p className="font-semibold">{item.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("ar-EG", { calendar: "gregory" }) : "-"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{item.body}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {item.target === "all"
                      ? item.status === "sending"
                        ? `جاري الإرسال... (${item.estimatedCount ?? "?"} مستخدم متوقَّع)`
                        : `بُث لكل المستخدمين (${item.sentCount})`
                      : "لمستخدم واحد"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">لا توجد إشعارات مُرسلة بعد</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Notifications() {
  return (
    <AdminGuard activeKey="notifications">
      {() => <NotificationsContent />}
    </AdminGuard>
  );
}
