import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Lock, Loader2, Eye, EyeOff } from "lucide-react";
import Layout from "@/components/Layout";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "firebase/auth";
import { toast } from "sonner";
import { establishServerSession } from "@/lib/session";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // ✅ نؤسس كوكي الجلسة قبل التوجيه مباشرة (وليس نتركها لـuseAuth لاحقاً)
      // حتى لا يصل المستخدم للصفحة التالية قبل أن تكون الطلبات المحمية جاهزة.
      const idToken = await cred.user.getIdToken();
      await establishServerSession(idToken);
      toast.success("تم تسجيل الدخول بنجاح");
      setLocation("/");
    } catch (err: any) {
      const msg = err.code === "auth/user-not-found" ? "البريد الإلكتروني غير مسجل"
        : err.code === "auth/wrong-password" ? "كلمة المرور غير صحيحة"
        : err.code === "auth/invalid-email" ? "البريد الإلكتروني غير صحيح"
        : err.code === "auth/too-many-requests" ? "تم تجاوز عدد المحاولات، يرجى المحاولة لاحقاً"
        : "فشل تسجيل الدخول";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(auth, provider);
      const idToken = await cred.user.getIdToken();
      await establishServerSession(idToken);
      toast.success("تم تسجيل الدخول بنجاح");
      setLocation("/");
    } catch (err: any) {
      const msg = "فشل تسجيل الدخول عبر Google";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) { toast.error("يرجى إدخال بريدك الإلكتروني"); return; }
    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      toast.success("تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني");
      setShowForgot(false);
      setForgotEmail("");
    } catch (err: any) {
      toast.error("لم يتم العثور على حساب بهذا البريد الإلكتروني");
    } finally {
      setForgotLoading(false);
    }
  };

  if (showForgot) {
    return (
      <Layout>
        <div className="min-h-[90vh] flex items-center justify-center py-12 px-4 bg-background">
          <div className="w-full max-w-md">
            <Card className="border-border bg-card overflow-hidden shadow-lg">
              <div className="h-1 bg-primary"></div>
              <CardContent className="p-8">
                <div className="text-center mb-8">
                  <div className="flex flex-col items-center gap-2 mb-6">
                    <span className="text-4xl font-bold" style={{ color: 'var(--primary)', fontFamily: 'Georgia, serif' }}>11</span>
                    <span className="text-xs tracking-widest font-bold" style={{ color: 'var(--primary)' }}>ELEVEN</span>
                  </div>
                  <h1 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: 'Georgia, serif' }}>
                    استعادة كلمة المرور
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    سنرسل رابط الاسترداد إلى بريدك الإلكتروني
                  </p>
                </div>
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">البريد الإلكتروني</label>
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="your@email.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="pr-10 h-11 border-border bg-secondary/30 focus:ring-2 focus:ring-primary rounded-lg"
                        required
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-base rounded-lg"
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري الإرسال...</> : "إرسال رابط الاسترداد"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setShowForgot(false)}
                  >
                    العودة لتسجيل الدخول
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[90vh] flex items-center justify-center py-12 px-4 bg-background">
        <div className="w-full max-w-md">
          <Card className="border-border bg-card overflow-hidden shadow-lg">
            <div className="h-1 bg-primary"></div>
            <CardContent className="p-8">
              <div className="text-center mb-8">
                <div className="flex flex-col items-center gap-2 mb-6">
                  <span className="text-4xl font-bold" style={{ color: 'var(--primary)', fontFamily: 'Georgia, serif' }}>11</span>
                  <span className="text-xs tracking-widest font-bold" style={{ color: 'var(--primary)' }}>ELEVEN</span>
                </div>
                <h1 className="text-3xl font-bold text-foreground mb-2" style={{ fontFamily: 'Georgia, serif' }}>
                  لوحة التحكم
                </h1>
                <p className="text-sm text-muted-foreground">تسجيل الدخول مخصص لفريق الإدارة فقط</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="p-4 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg text-sm font-medium">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">البريد الإلكتروني</label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pr-10 h-11 border-border bg-secondary/30 focus:ring-2 focus:ring-primary rounded-lg"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-semibold text-foreground">كلمة المرور</label>
                    <button
                      type="button"
                      onClick={() => setShowForgot(true)}
                      className="text-xs text-primary font-semibold hover:text-primary/80"
                    >
                      نسيت كلمة المرور؟
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10 pl-10 h-11 border-border bg-secondary/30 focus:ring-2 focus:ring-primary rounded-lg"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-base rounded-lg transition-all"
                  disabled={loading}
                >
                  {loading ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري التحميل...</> : "تسجيل الدخول"}
                </Button>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-card text-muted-foreground font-semibold uppercase tracking-wider">أو</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 border-border hover:bg-secondary/30 font-semibold gap-3 rounded-lg"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  تسجيل الدخول عبر Google
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
