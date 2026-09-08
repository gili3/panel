import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, ImagePlus, X } from "lucide-react";
import { uploadImageToStorage } from "@/lib/imageUpload";

type NotificationTypeOption = "general" | "promo" | "welcome";

function NotificationsContent() {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | "user">("all");
  const [targetEmail, setTargetEmail] = useState("");
  const [actionRoute, setActionRoute] = useState("");
  const [notifType, setNotifType] = useState<NotificationTypeOption>("general");

  // ✅ جديد (صورة العرض): معاينة + حالة رفع منفصلة — لا نسمح بالإرسال قبل
  // اكتمال الرفع بنجاح (زر الإرسال معطَّل أثناء isUploadingImage أدناه).
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

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
      setNotifType("general");
      handleRemoveImage();
      utils.adminNotifications.getHistory.invalidate();
    },
    onError: (err) => toast.error(err.message || "تعذّر إرسال الإشعار"),
  });

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // يسمح باختيار نفس الملف مرة أخرى لاحقاً إن أُزيل
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("نوع الصورة غير مدعوم — استخدم JPG أو PNG أو WebP فقط");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("حجم الصورة يجب ألا يتجاوز 10 ميجابايت");
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setUploadedImageUrl(null);
    setIsUploadingImage(true);
    try {
      const url = await uploadImageToStorage(file, "notifications");
      setUploadedImageUrl(url);
    } catch (err: any) {
      toast.error(err?.message || "تعذّر رفع الصورة");
      setImageFile(null);
      setImagePreview(null);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrl(null);
    setIsUploadingImage(false);
  };

  const handleSend = () => {
    if (!title.trim() || !body.trim()) {
      toast.error("العنوان والنص مطلوبان");
      return;
    }
    if (target === "user" && !foundUser) {
      toast.error("لم يتم العثور على مستخدم بهذا البريد");
      return;
    }
    // ✅ منع الإرسال قبل اكتمال رفع الصورة بنجاح (كما طُلب) — إن اختار
    // المستخدم صورة لكن الرفع لا يزال جارياً أو فشل بلا رابط نهائي.
    if (imageFile && !uploadedImageUrl) {
      toast.error(isUploadingImage ? "الرجاء الانتظار حتى اكتمال رفع الصورة" : "تعذّر رفع الصورة، أعد المحاولة أو أزلها");
      return;
    }
    sendNotification.mutate({
      title: title.trim(),
      body: body.trim(),
      target,
      userId: target === "user" ? foundUser?.uid : undefined,
      actionRoute: actionRoute.trim() || undefined,
      imageUrl: uploadedImageUrl || undefined,
      type: notifType,
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
            <label className="text-sm font-medium block mb-1.5">نوع الإشعار</label>
            <Select value={notifType} onValueChange={(v) => setNotifType(v as NotificationTypeOption)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">عام</SelectItem>
                <SelectItem value="promo">عرض ترويجي</SelectItem>
                <SelectItem value="welcome">ترحيب</SelectItem>
              </SelectContent>
            </Select>
          </div>

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

          <div>
            <label className="text-sm font-medium block mb-1.5">صورة العرض (اختياري)</label>
            {imagePreview ? (
              <div className="relative w-40">
                <img src={imagePreview} alt="معاينة الصورة" className="w-40 h-40 object-cover rounded-lg border" />
                {isUploadingImage && (
                  <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
                {!isUploadingImage && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute -top-2 -left-2 bg-destructive text-destructive-foreground rounded-full p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {uploadedImageUrl && !isUploadingImage && (
                  <p className="text-xs text-emerald-600 mt-1">تم الرفع بنجاح</p>
                )}
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-40 h-40 border-2 border-dashed rounded-lg cursor-pointer text-muted-foreground hover:bg-muted/50">
                <ImagePlus className="w-6 h-6 mb-1" />
                <span className="text-xs">JPG, PNG, WebP</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
              </label>
            )}
          </div>

          <Button
            onClick={handleSend}
            disabled={sendNotification.isPending || isUploadingImage}
            className="w-full sm:w-auto"
          >
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
                    <div className="flex items-start gap-2">
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" loading="lazy" />
                      )}
                      <p className="font-semibold">{item.title}</p>
                    </div>
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
