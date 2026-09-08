import { auth, db } from "@/lib/firebase";
import { getCurrentDeviceToken } from "@/lib/push";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  getCachedAuthFlag,
  setCachedAuthFlag,
  establishServerSession,
  clearServerSession,
  fetchWhoAmI,
} from "@/lib/session";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } =
    options ?? {};

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

  // جلب بيانات المستخدم الكاملة من السيرفر (بما فيها الدور)
  const { data: serverUser, isLoading: isServerUserLoading, refetch: refetchServerUser } = 
    trpc.auth.me.useQuery(undefined, {
      enabled: !!firebaseUser,
    });

  // ✅ مسار سريع مستقل تماماً عن تهيئة Firebase SDK: نسأل السيرفر مباشرة عن
  // حالة كوكي الجلسة فور الإقلاع، بالتوازي وليس بعد انتظار onAuthStateChanged.
  // هذا عادة أسرع بكثير (طلب HTTP خفيف واحد) من استعادة جلسة Firebase محلياً
  // خصوصاً عند أول تحميل أو على شبكات بطيئة — وهو ما يعطي إحساس "جلسة فورية"
  // مطابق للمواقع الكبيرة التي تعتمد كوكيز الجلسة بدل انتظار SDK بالكامل.
  useEffect(() => {
    let cancelled = false;
    fetchWhoAmI().then((whoAmIUser) => {
      if (cancelled || !whoAmIUser) return;
      setUser((prev: any) => prev ?? { ...whoAmIUser, phone: "" });
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
        
        // ✅ إعادة جلب بيانات المستخدم من السيرفر لتحديث sessionReady
        refetchServerUser();
      },
      (err) => {
        setError(err);
        setFirebaseChecked(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [refetchServerUser]);

  // تحديث user فور توفر جلسة Firebase (دور مبدئي "user")، ثم رفعه فوراً
  // لـ"admin" بصمت بمجرد وصول رد السيرفر — بدون أي حجب أو وميض بالواجهة
  useEffect(() => {
    if (!firebaseUser) return;
    const enrichedUser = {
      ...firebaseUser,
      id: firebaseUser.uid,
      openId: firebaseUser.uid,
      email: firebaseUser.email,
      name: profileDoc?.name || firebaseUser.displayName || "",
      phone: profileDoc?.phone || "",
      role: serverUser?.role || "user",
      isSuperAdmin: Boolean((serverUser as any)?.isSuperAdmin),
      permissions: (serverUser as any)?.permissions ?? [],
    };
    setUser(enrichedUser);
  }, [firebaseUser, serverUser, profileDoc]);

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
      // أي فشل بجلب/حذف التوكن لا يجب أن يمنع تسجيل الخروج نفسه أبداً.
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
          // نتجاهل الفشل هنا عمداً — تسجيل الخروج أهم، والتوكن سينتهي
          // صلاحيته من طرف FCM لاحقاً في أسوأ الأحوال.
        }
      }

      await Promise.all([signOut(auth), clearServerSession()]);
      setUser(null);
    } catch (err) {
      setError(err as Error);
    }
  }, [removeFcmToken]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    // ✅ ننتظر تأكيد Firebase الفعلي (وليس فقط "loading" المتفائل) قبل أي
    // تحويل حقيقي لصفحة الدخول — يمنع تحويل مستخدم مسجّل دخول فعلاً بالخطأ
    // خلال اللحظة المبكرة من التحميل المتفائل.
    if (!firebaseChecked) return;
    if (user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, firebaseChecked, user]);

  return {
    user,
    loading, // ✅ سريع: يبدأ متفائلاً من فلاغ محلي أو من whoami، ولا ينتظر السيرفر لتحديد الدور
    // ✅ للاستخدام فقط بالأماكن التي تحتاج تحديداً تأكيد الدور (مثال: بوابة صفحة الأدمن)
    // قبل تنفيذ أي إجراء حسّاس — بقية الصفحات (سلة، طلبات، ملف شخصي) لا تحتاجه إطلاقاً.
    roleLoading: Boolean(firebaseUser) && isServerUserLoading,
    // ✅ مهم: true فقط بعد تأكيد فعلي من السيرفر أن كوكي الجلسة (fb_session)
    // نشِطة وصالحة — وليس فقط أن Firebase SDK لديه مستخدماً محلياً. يوجد فارق
    // زمني حقيقي بينهما (راجع lib/session.ts::establishServerSession): عند
    // أول تحميل بعد تسجيل دخول جديد، قد يصبح "user" أعلاه جاهزاً قبل أن يكتمل
    // إرسال idToken وتأكيد الكوكي بالسيرفر بلحظات. أي طلب تجاه إجراء محمي
    // (protectedProcedure) يُطلَق خلال هذه الفجوة — أهمها تسجيل توكن FCM عند
    // فتح الصفحة — يفشل بصمت (401) دون أي إشعار للمستخدم أو إعادة محاولة،
    // فتبقى قائمة fcmTokens فارغة ولا يصل أي Push إطلاقاً رغم أن الإذن ممنوح
    // فعلياً بالمتصفح. استخدم هذا الحقل لتأجيل أي إجراء كهذا حتى يصبح true.
    sessionReady: Boolean(serverUser) && !isServerUserLoading,
    error,
    isAuthenticated: Boolean(user),
    refresh: () => {}, // Firebase handles this automatically
    logout,
    updateUserProfile,
  };
}