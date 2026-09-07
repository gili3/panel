import { useState } from "react";
import { useLocation, Link } from "wouter";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LogOut, ChevronLeft, Trash2, Lock, Eye, EyeOff, FileText, ShieldCheck, Loader2
} from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  signOut, updatePassword, deleteUser, EmailAuthProvider, GoogleAuthProvider,
  reauthenticateWithCredential, reauthenticateWithPopup,
} from "firebase/auth";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Settings() {
  const [, setLocation] = useLocation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // ✅ إصلاح: auth.currentUser يُقرأ مرة واحدة فقط عند أول رندر، وليس تفاعلياً
  // — لو فتح المستخدم /settings مباشرة (تحديث الصفحة أو رابط مباشر) قبل أن
  // يُكمل Firebase SDK استعادة الجلسة محلياً، يظهر هذا كأنه "غير مسجّل دخول"
  // ولو كان مسجّلاً فعلاً. نستخدم useAuth() التفاعلي (نفس مصدر الحقيقة في
  // باقي الموقع) لمعرفة حالة الدخول، مع الإبقاء على auth.currentUser فقط
  // للعمليات التي تحتاج كائن Firebase User الفعلي (إعادة المصادقة والحذف).
  const { user: authUser, loading: authLoading } = useAuth();
  const user = auth.currentUser;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success("تم تسجيل الخروج بنجاح");
      setLocation("/login");
    } catch {
      toast.error("فشل تسجيل الخروج");
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (!user?.email) return;
    setLoading(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      toast.success("تم تغيير كلمة المرور بنجاح");
      setShowChangePassword(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: any) {
      const msg = err.code === "auth/wrong-password" ? "كلمة المرور الحالية غير صحيحة" : "فشل تغيير كلمة المرور";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const isGoogleAccount = !!user?.providerData?.some(p => p.providerId === GoogleAuthProvider.PROVIDER_ID);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePw, setShowDeletePw] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
      if (isGoogleAccount) {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else {
        if (!user.email) throw new Error("لا يوجد بريد إلكتروني مرتبط بالحساب");
        if (!deletePassword) { toast.error("يرجى إدخال كلمة المرور الحالية"); setIsDeleting(false); return; }
        const credential = EmailAuthProvider.credential(user.email, deletePassword);
        await reauthenticateWithCredential(user, credential);
      }
      await deleteUser(user);
      toast.success("تم حذف الحساب بنجاح");
      setShowDeleteDialog(false);
      setLocation("/");
    } catch (err: any) {
      const msg = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "كلمة المرور الحالية غير صحيحة"
        : "تعذّر حذف الحساب، حاول مرة أخرى";
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-40">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Georgia, serif' }}>الإعدادات</h1>

          {/* Account security */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="w-5 h-5 text-primary" /> الحساب
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {authUser ? (
                <>
                  <div className="p-3 bg-secondary/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">الحساب الحالي</p>
                    <p className="text-sm font-medium text-foreground">{user?.email}</p>
                  </div>

                  <button
                    onClick={() => setShowChangePassword(!showChangePassword)}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">تغيير كلمة المرور</span>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                  </button>

                  {showChangePassword && (
                    <form onSubmit={handleChangePassword} className="space-y-3 p-3 bg-secondary/20 rounded-lg">
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type={showCurrentPw ? "text" : "password"}
                          placeholder="كلمة المرور الحالية"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full pr-9 pl-9 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                          required
                        />
                        <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute left-3 top-1/2 -translate-y-1/2">
                          {showCurrentPw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type={showNewPw ? "text" : "password"}
                          placeholder="كلمة المرور الجديدة"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full pr-9 pl-9 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                          required
                        />
                        <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute left-3 top-1/2 -translate-y-1/2">
                          {showNewPw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      </div>
                      <input
                        type="password"
                        placeholder="تأكيد كلمة المرور الجديدة"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                      />
                      <div className="flex gap-2">
                        <Button type="submit" className="flex-1 bg-primary text-primary-foreground h-9 text-sm" disabled={loading}>
                          {loading ? "جاري الحفظ..." : "حفظ"}
                        </Button>
                        <Button type="button" variant="outline" className="flex-1 h-9 text-sm" onClick={() => setShowChangePassword(false)}>
                          إلغاء
                        </Button>
                      </div>
                    </form>
                  )}

                  <Separator />

                  <button
                    onClick={() => { setDeletePassword(""); setShowDeleteDialog(true); }}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-destructive/10 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-destructive" />
                      <span className="text-sm text-destructive">حذف الحساب</span>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                  </button>
                </>
              ) : (
                // ✅ إصلاح: هذا القسم كان يظهر أزرار "تغيير كلمة المرور"
                // و"حذف الحساب" دائماً حتى لزائر غير مسجّل دخول، فتفشل
                // بصمت أو برسالة عامة عند الضغط بدل توضيح المطلوب فعلياً.
                <div className="text-center py-4 space-y-3">
                  <p className="text-sm text-muted-foreground">سجّل الدخول لإدارة إعدادات حسابك</p>
                  <Link href="/login">
                    <a>
                      <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                        تسجيل الدخول
                      </Button>
                    </a>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legal */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="w-5 h-5 text-primary" /> القانونية
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Link href="/privacy-policy">
                <a className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">سياسة الخصوصية</span>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </a>
              </Link>
              <Separator />
              <Link href="/terms">
                <a className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">الشروط والأحكام</span>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </a>
              </Link>
            </CardContent>
          </Card>

          {/* Logout */}
          {authUser && (
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full h-12 border-destructive text-destructive hover:bg-destructive hover:text-white gap-2 font-semibold rounded-lg"
            >
              <LogOut className="w-5 h-5" />
              تسجيل الخروج
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground pb-4">
            Eleven Store — النسخة 1.0.0
          </p>
        </div>

        <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!isDeleting) setShowDeleteDialog(open); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>حذف الحساب نهائياً</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              سيتم حذف حسابك وكل بياناته نهائياً، ولا يمكن التراجع عن هذا الإجراء.
            </p>
            {isGoogleAccount ? (
              <p className="text-sm text-muted-foreground">للمتابعة، يجب تأكيد هويتك عبر Google مرة أخرى.</p>
            ) : (
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showDeletePw ? "text" : "password"}
                  placeholder="كلمة المرور الحالية"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  disabled={isDeleting}
                  className="w-full pr-9 pl-9 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button type="button" onClick={() => setShowDeletePw(!showDeletePw)} className="absolute left-3 top-1/2 -translate-y-1/2">
                  {showDeletePw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={isDeleting} onClick={() => setShowDeleteDialog(false)}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                disabled={isDeleting || (!isGoogleAccount && !deletePassword)}
                onClick={handleDeleteAccount}
              >
                {isDeleting ? "جاري الحذف..." : "حذف نهائياً"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
