import { auth, db } from "@/lib/firebase";
import { getCurrentDeviceToken } from "@/lib/push";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { trpc } from "@/lib/trpc";
import {
  getCachedAuthFlag,
  setCachedAuthFlag,
  establishServerSession,
  clearServerSession,
  fetchWhoAmI,
  type WhoAmIUser,
} from "@/lib/session";

const REDIRECT_PATH = "/login";

// ✅ إصلاح جذري "التأخير + التحويل المتكرر لصفحة الدخول عند التنقّل بين
// أقسام اللوحة" (Users/Notifications وغيرها): كل صفحة إدارية كانت تستدعي
// useAuth() بشكل مستقل تماماً — أي أن الاشتراك بـFirebase وطلب whoami
// وكل هذا المنطق كان يُعاد **من الصفر** مع كل تنقّل بين الصفحات عبر الشريط
// الجانبي (حتى أن التنقّل SPA فعلياً عبر wouter، بلا أي إعادة تحميل كاملة
// للمتصفح — لأن AdminGuard بكل صفحة يُنشئ نسخة جديدة كلياً من الحالة).
// هذا كان يعني: طلب whoami شبكي جديد بكل تنقّل، واشتراك Firebase جديد بكل
// تنقّل، وإعادة تعريض نافذة السباق أدناه (raceExplanation) في كل مرة أيضاً.
// الحل: هذا الملف الآن يوفّر AuthProvider واحد يُركَّب مرة واحدة فقط بجذر
// التطبيق (راجع App.tsx) ويحسب حالة تسجيل الدخول مرة واحدة، وكل الصفحات
// تشترك بنفس الحالة عبر useAuth() (سياق React) دون أي إعادة حساب.
function useAuthState() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<any | null>(null);
  // ✅ إصلاح أداء (تسريع "جلب الجلسة" عند فتح الموقع): تُبدَأ الحالة متفائلة
  // (loading=false) لو كان آخر زيارة كانت مسجّلة دخول فعلاً — بدل انتظار
  // Firebase SDK يستعيد الجلسة محلياً أولاً في كل مرة. هذا فلاغ محلي فقط
  // لتحسين إحساس السرعة بالواجهة (سبينر/حجب)، وليس مصدر ثقة لأي بيانات.
  const [loading, setLoading] = useState<boolean>(() => !getCachedAuthFlag());
  const [error, setError] = useState<Error | null>(null);
  // بيانات وثيقة المستخدم في Firestore (فيها phone الذي لا يوفره Firebase Auth للتسجيل بالبريد)
  const [profileDoc, setProfileDoc] = useState<{ name?: string; phone?: string } | null>(null);

  // ✅ يصبح true فقط بعد أول رد فعلي من Firebase SDK نفسه (وليس من الفلاغ
  // المحلي المتفائل) — يُستخدم حصراً كشرط أمان قبل أي تحويل فعلي لصفحة
  // الدخول، حتى لا نُحوّل مستخدماً مسجّلاً دخول فعلاً بسبب لحظة تحميل مبكرة.
  const [firebaseChecked, setFirebaseChecked] = useState(false);

  // ✅ إصلاح "تأخر التحقق بلوحة التحكم عند الفتح/التحديث": whoami يرجّع الآن
  // كل ما تحتاجه اللوحة بطلب واحد فقط (الدور + الصلاحيات + isSuperAdmin) عبر
  // نفس دالة buildUser() التي يستخدمها سيرفر tRPC بالضبط (راجع
  // admin/server/_core/buildUser.ts) — مصدر وحيد وكامل، طلب شبكة واحد فقط.
  const [whoAmIUser, setWhoAmIUser] = useState<WhoAmIUser>(null);
  // true فقط قبل وصول أول رد فعلي (نجاحاً أو فشلاً) من whoami — بعدها لا
  // يحجب أي تحديث لاحق (تحديثات الصلاحيات تنعكس بصمت دون أي حجب أو وميض).
  const [whoAmIResolved, setWhoAmIResolved] = useState(false);

  const refreshWhoAmI = useCallback(async () => {
    const result = await fetchWhoAmI();
    setWhoAmIUser(result);
    setWhoAmIResolved(true);
    return result;
  }, []);

  useEffect(() => {
    if (!firebaseUser) {
      setProfileDoc(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
      setProfileDoc(snap.exists() ? (snap.data() as { name?: string; phone?: string }) : null);
    });
    return () => unsubscribe();
  }, [firebaseUser]);

  // ✅ إصلاح "تأخر اكتشاف تغيّر الصلاحيات": whoami لا يُخزَّن مؤقتاً على
  // العميل، لكن دون سبب لإعادة طلبه لا يصل أي تحديث تلقائي لو تغيّرت صلاحيات
  // هذا المستخدم بينما جلسته مفتوحة أصلاً. الحل: مراقبة role/adminPermissions
  // /disabled عبر onSnapshot حي (نفس وثيقة Firestore التي تقرأها buildUser()
  // بالسيرفر) — فور أي تغيّر فعلي بهذه الحقول تحديداً نعيد استدعاء whoami.
  const lastPermSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!firebaseUser) {
      lastPermSignatureRef.current = null;
      return;
    }
    const unsubscribe = onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      const permSignature = JSON.stringify({
        role: data?.role ?? null,
        adminPermissions: Array.isArray(data?.adminPermissions) ? data!.adminPermissions : [],
        disabled: Boolean(data?.disabled),
      });
      if (lastPermSignatureRef.current !== null && lastPermSignatureRef.current !== permSignature) {
        refreshWhoAmI();
      }
      lastPermSignatureRef.current = permSignature;
    });
    return () => unsubscribe();
  }, [firebaseUser, refreshWhoAmI]);

  // ✅ مسار سريع مستقل تماماً عن تهيئة Firebase SDK: نسأل السيرفر مباشرة عن
  // حالة كوكي الجلسة فور الإقلاع، بالتوازي وليس بعد انتظار onAuthStateChanged.
  useEffect(() => {
    let cancelled = false;
    fetchWhoAmI().then((result) => {
      if (cancelled) return;
      setWhoAmIResolved(true);
      if (!result) return;
      setUser((prev: any) => prev ?? { ...result, phone: "" });
      setWhoAmIUser(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser) => {
        setFirebaseUser(fbUser);
        setFirebaseChecked(true);
        setLoading(false); // ✅ لا ننتظر رد السيرفر — Firebase وحدها تكفي لمعرفة إن كان هناك جلسة

        if (!fbUser) {
          setUser(null);
          setWhoAmIUser(null);
          setCachedAuthFlag(false);
          return;
        }

        // ✅ مزامنة كوكي الجلسة مع السيرفر مرة واحدة فقط لكل جلسة فعلية (وليس
        // مع كل إعادة تشغيل onAuthStateChanged) — هذا ما يجعل كل الطلبات
        // القادمة وكل تحميل صفحة تالٍ سريعاً عبر الكوكي، دون أي Bearer يدوي.
        if (!getCachedAuthFlag()) {
          try {
            const idToken = await fbUser.getIdToken();
            await establishServerSession(idToken);
          } catch (err) {
            console.error("[Auth] فشل إنشاء جلسة السيرفر (fb_session):", err);
          }
        }

        // ✅ إعادة جلب بيانات المستخدم من whoami لتحديث sessionReady والدور
        refreshWhoAmI();
      },
      (err) => {
        setError(err);
        setFirebaseChecked(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [refreshWhoAmI]);

  // تحديث user فور توفر جلسة Firebase (دور مبدئي "user")، ثم رفعه فوراً
  // لـ"admin" بصمت بمجرد وصول رد whoami — بدون أي حجب أو وميض بالواجهة
  useEffect(() => {
    if (!firebaseUser) return;
    const enrichedUser = {
      ...firebaseUser,
      id: firebaseUser.uid,
      openId: firebaseUser.uid,
      email: firebaseUser.email,
      name: profileDoc?.name || firebaseUser.displayName || "",
      phone: profileDoc?.phone || "",
      role: whoAmIUser?.role || "user",
      isSuperAdmin: Boolean(whoAmIUser?.isSuperAdmin),
      permissions: whoAmIUser?.permissions ?? [],
    };
    setUser(enrichedUser);
  }, [firebaseUser, whoAmIUser, profileDoc]);

  const updateUserProfile = useCallback(async (name: string, phone: string) => {
    if (!auth.currentUser) throw new Error("لا يوجد مستخدم مسجل الدخول");
    const { updateProfile: updateFirebaseProfile } = await import("firebase/auth");
    const { setDoc } = await import("firebase/firestore");

    await updateFirebaseProfile(auth.currentUser, { displayName: name });
    await setDoc(
      doc(db, "users", auth.currentUser.uid),
      { name, phone },
      { merge: true }
    );
    // تحديث الحالة محلياً فوراً (onSnapshot سيلتقط نفس القيم لاحقاً أيضاً)
    setProfileDoc((prev) => ({ ...prev, name, phone }));
  }, []);

  const removeFcmToken = trpc.firestore.removeFcmToken.useMutation();

  const logout = useCallback(async () => {
    try {
      // ✅ إصلاح خصوصية: نحذف توكن FCM الخاص *بهذا الجهاز/المتصفح تحديداً*
      // قبل signOut. بدون هذا، لو استُخدم نفس الجهاز (متصفح مشترك) لاحقاً من
      // شخص آخر، يبقى توكن الحساب الحالي مسجَّلاً وموجّهاً فعلياً لنفس
      // الجهاز — فإشعارات حسّاسة (تفاصيل طلب) قد تصل لشخص آخر يستخدم الجهاز
      // فعلياً الآن. نجلب التوكن أولاً بينما المستخدم لا يزال مسجّل دخول
      // (removeFcmToken محمي بـ protectedProcedure)، ثم نحذفه، ثم نسجّل الخروج.
      let token: string | null = null;
      try {
        token = await getCurrentDeviceToken();
      } catch {
        token = null;
      }
      if (token) {
        try {
          await removeFcmToken.mutateAsync({ token });
        } catch {
          // نتجاهل الفشل هنا عمداً — تسجيل الخروج أهم.
        }
      }

      await Promise.all([signOut(auth), clearServerSession()]);
      setUser(null);
      setWhoAmIUser(null);
    } catch (err) {
      setError(err as Error);
    }
  }, [removeFcmToken]);

  // ✅ إصلاح خطأ سباق حقيقي كان سبب "التحويل لصفحة الدخول ثم الرجوع مرتين
  // أو ثلاث": كان هذا الإفكت يعتمد على `user` (حالة مُشتقّة تُحسَب بإفكت آخر
  // منفصل)، بينما كلا الإفكتين يعملان بنفس الدورة عند لحظة تأكد Firebase من
  // وجود المستخدم (`firebaseChecked` يصبح true بنفس اللحظة). بما أن تحديثات
  // useState داخل إفكت لا تُطبَّق فوراً على نفس الدورة، كان هذا الإفكت (الذي
  // يعمل بعد إفكت "تحديث user" بترتيب التعريف) يرى القيمة القديمة لـ`user`
  // (عادة null) رغم أن Firebase أكّد للتو وجود مستخدم فعلي مسجّل دخول —
  // فيُنفَّذ تحويل خاطئ فوري لصفحة الدخول. الإصلاح: الاعتماد مباشرة على
  // `firebaseUser` (مصدر الحقيقة، يُحدَّث بنفس الدورة التي يُحدَّث بها
  // firebaseChecked، بلا أي تأخر دورة) بدل `user` المُشتقّ.
  useEffect(() => {
    if (!firebaseChecked) return;
    if (firebaseUser) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === REDIRECT_PATH) return;

    window.location.href = REDIRECT_PATH;
  }, [firebaseChecked, firebaseUser]);

  return {
    user,
    loading, // ✅ سريع: يبدأ متفائلاً من فلاغ محلي أو من whoami، ولا ينتظر أي طلب ثانٍ لتحديد الدور
    // ✅ للاستخدام فقط بالأماكن التي تحتاج تحديداً تأكيد الدور (مثال: بوابة صفحة الأدمن)
    // قبل تنفيذ أي إجراء حسّاس. يعتمد على استعلام واحد فقط (whoami).
    roleLoading: Boolean(firebaseUser) && !whoAmIResolved,
    // ✅ مهم: true فقط بعد تأكيد فعلي من السيرفر أن كوكي الجلسة (fb_session)
    // نشِطة وصالحة — وليس فقط أن Firebase SDK لديه مستخدماً محلياً.
    sessionReady: Boolean(whoAmIUser) && whoAmIResolved,
    error,
    isAuthenticated: Boolean(user),
    refresh: () => {}, // Firebase handles this automatically
    logout,
    updateUserProfile,
  };
}

type AuthContextValue = ReturnType<typeof useAuthState>;
const AuthContext = createContext<AuthContextValue | null>(null);

// ✅ يُركَّب مرة واحدة فقط بجذر التطبيق (App.tsx) — كل الصفحات والمكوّنات
// تشترك بنفس حالة تسجيل الدخول عبر useAuth() أدناه، بدل أن تُعيد كل صفحة
// حساب هذه الحالة من الصفر عند كل تنقّل SPA.
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() يجب أن يُستخدَم داخل <AuthProvider> (راجع App.tsx)");
  }
  return ctx;
}
