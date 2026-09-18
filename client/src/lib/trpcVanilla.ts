import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

/**
 * ELEVEN STORE — عميل tRPC "خام" بلا React
 * ─────────────────────────────────────────────────────────
 * lib/trpc.ts (createTRPCReact) يتطلب <trpc.Provider> بشجرة React، وهو غير
 * متاح لمستمعي window.onerror/'unhandledrejection' (قد تحدث قبل اكتمال
 * أول render أصلاً). هذا عميل مبسّط لنفس الـendpoint، يُستخدم فقط من
 * lib/errorReporter.ts — الكوكي (fb_session) يُرسَل تلقائياً بـcredentials:
 * "include" فيتعرّف السيرفر على المستخدم إن كان مسجّل دخول، بلا أي منطق إضافي.
 */
export const trpcVanilla = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(url, options) {
        return fetch(url as string, { ...options, credentials: "include" });
      },
    }),
  ],
});
