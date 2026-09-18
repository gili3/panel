// ELEVEN STORE — إعداد ESLint (Flat Config، ESLint 9+)
// ─────────────────────────────────────────────────────────────────────────
// ✅ إضافة: لم يكن يوجد أي إعداد ESLint باللوحة سابقاً (لا .eslintrc ولا
// eslint.config.js، ولا حزمة eslint أصلاً بـpackage.json) — أي خطأ شائع
// (متغير غير مستخدم، hook مستخدَم بشرط، مقارنة == بدل ===...) كان يُكتشف
// فقط لو كسر tsc فعلياً أو ظهر أثره وقت التشغيل. هذا الإعداد يغطي:
//   1) client/src — React 19 + Hooks (قواعد Hooks الإلزامية + Fast Refresh)
//   2) server/ — Express + tRPC على Node
//   3) functions/src — Cloud Functions (حزمة TS منفصلة عن اللوحة، لها
//      tsconfig خاص بها — راجع functions/tsconfig.json)
// شغّل `pnpm lint` (أو `pnpm lint:fix` للإصلاح التلقائي) بعد `pnpm install`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    // ملفات لا حاجة لفحصها إطلاقاً (مخرجات بناء، تبعيات، ملفات مولَّدة)
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.manus-logs/**",
      "client/public/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── لوحة التحكم (React) ─────────────────────────────────────────────
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // ✅ يسمح بتصدير أي شيء آخر بجانب المكوّن بملفات shadcn/ui (variants,
      // buttonVariants...) بدل تحذير كل ملف مكوّن بمشروعنا الذي يتبع هذا
      // النمط أصلاً (مطابق لتوصية Vite React Refresh الرسمية لهذه الحالة).
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // ✅ TS نفسه (strict بـtsconfig.json) يكفي لالتقاط استخدام متغير قبل
      // تعريفه بأمان أكبر من قاعدة JS العامة هنا — نعطّل نسخة JS ونفعّل
      // نسخة TS فقط لتفادي نتائج مكرّرة (false positive) لأنواع مثل enums.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // shadcn/ui وبعض مكتبات الطرف الثالث تُصدَّر بأنواع "any" واسعة أحياناً؛
      // تحويلها لخطأ قاسٍ الآن سيولّد مئات التحذيرات دفعة واحدة على كود
      // موجود بالفعل بدل التركيز على كود جديد — تحذير بدل خطأ حالياً.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // ── السيرفر (Express + tRPC) ─────────────────────────────────────────
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // ✅ الطلبات المالية (createOrder، checkCoupon، الشحن...) تحديداً ما
      // دفعنا لإضافة ESLint من أساسه — == بدل === هنا كان يمكن أن يسبب
      // مقارنات خاطئة بين string/number لمعرّفات المنتجات أو أكواد الكوبونات.
      eqeqeq: ["error", "always"],
    },
  },

  // ── Cloud Functions (حزمة TS منفصلة، Node) ──────────────────────────
  {
    files: ["functions/src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "always"],
    },
  },

  // ── shared/ (يُستخدم من الاثنين، بلا globals بيئة محدَّدة) ───────────
  {
    files: ["shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ملفات الاختبار: vitest globals (describe/it/expect) بلا حاجة لاستيرادها
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
