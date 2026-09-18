import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import "react-phone-number-input/style.css"; // <-- أضف هذا السطر
import { AXIOS_TIMEOUT_MS } from "@shared/const";
import { auth } from "@/lib/firebase";
import { installGlobalErrorReporting } from "@/lib/errorReporter";

// ✅ إضافة (بطلب الأدمن: كل أخطاء اللوحة تظهر بمكان واحد بلوحة التحكم) —
// يُركَّب أول شيء عند إقلاع التطبيق، قبل أي render، حتى يُلتقَط حتى خطأ
// إقلاع مبكر جداً (مثال: فشل تهيئة Firebase نفسها).
installGlobalErrorReporting();

// ✅ إصلاح أداء: كان QueryClient بدون أي إعدادات افتراضية — أي staleTime=0
// يعني كل تنقّل بين الصفحات (وليس فقط تحديث المتصفح الكامل) قد يعيد جلب
// نفس البيانات من جديد فوراً. القيم أدناه معقولة لمتجر: البيانات "طازجة"
// لمدة 30 ثانية (لا إعادة جلب فورية غير ضرورية)، وتبقى بالذاكرة 5 دقائق حتى
// لو لم تُستخدم مؤقتاً، وتعطيل إعادة الجلب التلقائي عند رجوع نافذة المتصفح
// للتركيز (سلوك مزعج لتطبيق تسوق أكثر منه مفيد).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.data?.code === "UNAUTHORIZED";

  if (!isUnauthorized) return;

  window.location.href = "/login";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// ✅ إصلاح أداء (سبب رئيسي لبطء "جلب الجلسة" عند كل فتح للموقع): كان كل طلب
// tRPC ينتظر أولاً auth.currentUser ثم يستدعي user.getIdToken() بشكل غير
// متزامن قبل إرساله — أي طلب كان محجوباً بانتظار Firebase SDK. الآن نعتمد
// كوكي الجلسة httpOnly (fb_session، راجع lib/session.ts وserver/_core/context.ts)
// الذي يُرسَل تلقائياً مع كل طلب عبر credentials: "include"، دون أي انتظار
// أو استدعاء غير متزامن هنا إطلاقاً.
// ✅ إصلاح (Audit المرحلة 6، APIs والشبكة): لم يكن هناك أي مهلة زمنية
// (timeout) على أي طلب شبكة بكامل التطبيق — كان الثابت AXIOS_TIMEOUT_MS
// معرَّفاً بـshared/const.ts لكن غير موصول بأي مكان فعلياً (لا يوجد axios
// بالمشروع أصلاً). عملياً: أي طلب يتعلّق بجانب السيرفر (قاعدة بيانات بطيئة،
// شبكة الجوال ضعيفة، إلخ) كان يجعل الواجهة عالقة بمؤشر تحميل دوّار للأبد
// بلا أي رسالة خطأ تظهر للمستخدم. الآن كل طلب يُلغى تلقائياً بعد 30 ثانية
// برسالة خطأ واضحة (TRPCClientError) بدل التعليق الأبدي.
// ✅ إصلاح جذري لسباق الجلسة: كوكي الجلسة (fb_session) يبقى المسار الأساسي
// (لا تغيير هناك)، لكن الآن يُرفَق أيضاً هيدر Authorization: Bearer <idToken>
// الحيّ مع كل طلب — تماماً كما يوثّق تطبيق الأندرويد كل طلب مباشرة عبر
// Firebase Auth SDK دون أي خطوة جلسة منفصلة بالسيرفر. السيرفر (context.ts)
// يدعم هذا المسار أصلاً كـ"احتياطي" لكنه لم يكن يصل أبداً من قبل لأن أحداً
// لم يكن يرسله. الفائدة: أي طلب يصل *قبل* اكتمال إنشاء كوكي الجلسة (أول
// لحظات بعد تسجيل الدخول — بالضبط سبب عدم تسجيل توكن FCM سابقاً) يظل
// مصادَقاً عليه بنجاح عبر الـBearer، بدل أن يفشل بصمت (401) بانتظار الكوكي.
// auth.currentUser.getIdToken() سريع جداً عملياً (Firebase SDK يحتفظ بتوكن
// مخبأ صالح ولا يطلب شبكة إلا قرب انتهاء صلاحيته)، فلا يُبطئ الطلبات.
async function buildAuthHeader(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) return {};
  try {
    const idToken = await currentUser.getIdToken();
    return { Authorization: `Bearer ${idToken}` };
  } catch {
    return {};
  }
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(url, options) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AXIOS_TIMEOUT_MS);
        // مهم: لا نستبدل signal الأصلي القادم من React Query (يُستخدم لإلغاء
        // الطلب فعلياً عند مغادرة الصفحة/إعادة الجلب)، بل نضيف إلغاءنا
        // الخاص بالمهلة الزمنية فوقه — أي إلغاء من الاثنين يُلغي الطلب.
        const originalSignal = options?.signal;
        if (originalSignal) {
          if (originalSignal.aborted) controller.abort();
          else originalSignal.addEventListener("abort", () => controller.abort(), { once: true });
        }
        const authHeader = await buildAuthHeader();
        return fetch(url as string, {
          ...options,
          headers: { ...options?.headers, ...authHeader },
          credentials: "include",
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);