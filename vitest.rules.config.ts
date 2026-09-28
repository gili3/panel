import { defineConfig } from "vitest/config";

// اختبارات قواعد Firebase (Firestore + Storage) — تحتاج المحاكي، لذا ملفاتها *.rules-test.ts
// (لا يلتقطها `vitest run` العادي). التشغيل: pnpm test:rules
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.rules-test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // كلها تشارك محاكياً واحداً وتُنظّف بياناته بين الاختبارات
  },
});
