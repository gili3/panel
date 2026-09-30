/**
 * مزامنة مخزون منتج مع فهرس Algolia بعد الطلب (REST مباشر — لا نُضيف حزمة algoliasearch للدوال).
 * مطابق لما يفعله السيرفر بـserver/algolia-service.ts::resyncProductsStock لمسار الموقع، حتى لا
 * يظهر منتج نفد مخزونه للتو ضمن نتائج البحث. اختياري: بلا ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY
 * في functions/.env يُتجاهل بصمت. الفشل لا يؤثر أبداً على نجاح الطلب.
 */
type FetchFn = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number }>;

const TIMEOUT_MS = 3000;

export async function syncStockToAlgolia(updates: Array<{ productId: string; stock: number }>): Promise<void> {
  const appId = process.env.ALGOLIA_APP_ID;
  const apiKey = process.env.ALGOLIA_ADMIN_API_KEY;
  if (!appId || !apiKey || updates.length === 0) return;

  const index = encodeURIComponent(process.env.ALGOLIA_PRODUCTS_INDEX || "products");
  const fetchFn = (globalThis as unknown as { fetch?: FetchFn }).fetch;
  if (!fetchFn) return;

  const one = async ({ productId, stock }: { productId: string; stock: number }) => {
    // createIfNotExists=false: لا نُنشئ سجلاً ناقصاً لمنتج غير مفهرس أصلاً
    const url = `https://${appId}.algolia.net/1/indexes/${index}/${encodeURIComponent(productId)}/partial?createIfNotExists=false`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stock }),
    });
    if (!res.ok) console.error(`[Algolia] فشل تحديث مخزون ${productId}: HTTP ${res.status}`);
  };

  const all = Promise.all(updates.map((u) => one(u).catch((e) => console.error(`[Algolia] ${u.productId}:`, e))));
  await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, TIMEOUT_MS))]);
}
