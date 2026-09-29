import path from "node:path";
import { defineConfig } from "vitest/config";

// ✅ إصلاح: `vitest run` كان يلتقط vite.config.ts تلقائياً، وله root = client/،
// فيبحث عن الاختبارات داخل client/ فقط ("No test files found") بينما كل
// الاختبارات فعلياً بـserver/ وtests/functions/. هذا الملف يأخذ الأولوية على
// vite.config.ts ويحدّد الجذر والمسارات صراحةً، ويستبعد اختبارات قواعد Firebase
// (*.rules-test.ts) لأنها تحتاج المحاكي وتُشغَّل عبر `pnpm test:rules`.
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.{test,spec}.ts",
      "shared/**/*.{test,spec}.ts",
      "tests/functions/**/*.{test,spec}.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/rules/**"],
  },
});
