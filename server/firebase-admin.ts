import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    // محاولة التحميل من متغير بيئة يحتوي على JSON مفتاح الخدمة
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log("[Firebase Admin] Initializing with Service Account...");
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET
      });
      console.log("[Firebase Admin] Initialized successfully.");
    } else {
      console.warn("[Firebase Admin] FIREBASE_SERVICE_ACCOUNT not found. Falling back to default credentials...");
      admin.initializeApp();
    }
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
export const adminStorage = admin.storage();
