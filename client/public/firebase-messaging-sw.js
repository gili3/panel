// ELEVEN STORE — Firebase Messaging Service Worker
// مسؤول عن عرض إشعارات النظام عندما يكون الموقع بالخلفية أو مغلقاً، وفتح/
// تركيز الرابط الصحيح عند الضغط على الإشعار.
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js');

// يُفعِّل نسخة الـService Worker الجديدة فوراً بدل انتظار إغلاق كل تبويبات
// الموقع المفتوحة أولاً (السلوك الافتراضي). بدون هذا، أي تعديل على هذا
// الملف يبقى "بانتظار التفعيل" (waiting) والنسخة القديمة تستمر بمعالجة كل
// الإشعارات الواردة فعلياً — وهذا سبب شائع جداً لظهور تنبيه صامت بدل التنبيه
// المُصمَّم: النسخة التي تعمل فعلياً على جهاز الزائر ليست آخر نسخة تم نشرها.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ملاحظة: هذا الملف يُخدَّم كملف Service Worker ثابت على رابط مباشر
// (/firebase-messaging-sw.js) ولا يمر بخط بناء Vite، لذا لا يمكنه قراءة
// import.meta.env كبقية كود العميل (انظر lib/firebase.ts). القيم هنا ليست
// سرّية بحد ذاتها (الحماية الفعلية تأتي من قواعد أمان Firestore/Storage لا
// من سرية مفتاح Firebase للويب)، لكن يجب تحديثها يدوياً هنا إن تغيّر مشروع
// Firebase مستقبلاً، لأنها لن تتبع تلقائياً متغيرات البيئة VITE_FIREBASE_*.
firebase.initializeApp({
  apiKey: "AIzaSyB1vNmCapPK0MI4H_Q0ilO7OnOgZa02jx0",
  authDomain: "queen-beauty-b811b.firebaseapp.com",
  projectId: "queen-beauty-b811b",
  storageBucket: "queen-beauty-b811b.firebasestorage.app",
  messagingSenderId: "418964206430",
  appId: "1:418964206430:web:8c9451fc56ca7f956bd5cf",
});

const messaging = firebase.messaging();

const DEFAULT_TITLE = 'إشعار جديد';
const DEFAULT_ROUTE = '/notifications';

function buildNotificationOptions(data) {
  const actionRoute = data.actionRoute && data.actionRoute.startsWith('/') ? data.actionRoute : DEFAULT_ROUTE;
  // ✅ إصلاح v2: tag كان مبنياً من "type" فقط (`eleven-store-order` مثلاً)
  // — أي أن كل إشعارات "order" (استلام الطلب، ثم لاحقاً تغيّر الحالة إلى
  // "تم الشحن") كانت تتشارك نفس الـtag فتستبدل إحداها الأخرى صامتة! تحديث
  // حقيقي لاحق (renotify:true) كان يُنبّه المستخدم لكن العنوان/النص القديم
  // يختفي فوراً من مركز إشعارات النظام قبل أن يراه أصلاً. الآن نستخدم
  // notificationId (معرّف حتمي فريد لكل حدث تحديداً، وليس لكل نوع) —
  // تجميع فعلي فقط لإعادة تسليم *نفس* الحدث بالضبط من FCM (نادر لكن وارد
  // على مستوى الشبكة)، بينما أي حدث مختلف يظهر كإشعار منفصل تماماً كما يجب.
  const tag = data.notificationId || `eleven-store-${data.type || 'general'}-${Date.now()}`;
  return {
    body: data.body || '',
    icon: '/notification-icon.png',
    badge: '/badge-icon.png',
    vibrate: [200, 100, 200],
    silent: false,
    tag,
    renotify: true,
    data: { actionRoute },
  };
}

// ⚠️ السيرفر يرسل رسائل "data-only" حصراً (بدون حقل notification أعلى
// المستوى) عمداً — بهذا يُستدعى هذا المعالج دائماً بشكل مضمون بدل الاعتماد
// على مسار عرض صامت داخلي بالمتصفح لرسائل "notification" لا يصل على كثير
// من أجهزة الجوال. كل القيم بـ payload.data نصوص دائماً.
//
// نُعيد (return) الـPromise الناتج من showNotification صراحة: مكتبة FCM
// تُغلِّف push event بـ event.waitUntil() داخلياً وتنتظر ما تُعيده هذه
// الدالة — بدون return هنا، قد يُنهي المتصفح الـService Worker قبل اكتمال
// عرض الإشعار فعلياً (خاصة إن كان الجهاز بوضع توفير طاقة)، فيعتبر المتصفح
// أنه "لم يُعرض أي إشعار" ويحقن تنبيهه الصامت الافتراضي بدلاً منه.
//
// كما نضمن بـ try/catch أن showNotification يُستدعى دائماً ولو حدث أي خطأ
// غير متوقع بقراءة البيانات — استدعاء واحد ضامن دائماً بدل صمت كامل عند أي
// استثناء، لأن أي push بلا إشعار ظاهر يُعرَّض لعقاب المتصفح (تنبيه صامت
// عام لا نتحكم بشكله).
messaging.onBackgroundMessage((payload) => {
  try {
    const data = payload.data || {};
    const title = data.title || DEFAULT_TITLE;
    return self.registration.showNotification(title, buildNotificationOptions(data));
  } catch (error) {
    return self.registration.showNotification(DEFAULT_TITLE, buildNotificationOptions({}));
  }
});

// فتح/تركيز صفحة الموقع عند الضغط على الإشعار — يبحث أولاً عن تبويب مفتوح
// مسبقاً ويركّز عليه بدل فتح تبويب جديد دائماً (يماثل PendingIntent بتطبيق
// الأندرويد الذي يفتح MainActivity).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const actionRoute = event.notification.data?.actionRoute || DEFAULT_ROUTE;
  const targetUrl = new URL(actionRoute, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
