// ELEVEN STORE — التحقق من رابط إيصال الدفع قبل تخزينه بمستند الطلب
// ─────────────────────────────────────────────────────────────────────────
// السبب: updateOrderReceipt كان يقبل أي نص (z.string() بلا حد) ويكتبه كما هو في
// paymentReceipt، ثم تعرضه لوحة التحكم للأدمن كصورة/رابط. عميل خبيث كان يقدر يخزّن
// رابط موقع خارجي (تتبّع/تصيّد) أو مخطّط javascript:/data: أو إيصال يخص مستخدماً آخر.
// المقبول فقط: رابط تنزيل Firebase Storage عبر https داخل receipts/<uid صاحب الطلب>/.
export const MAX_RECEIPT_URL_LENGTH = 2048;

export function isValidReceiptUrl(rawUrl: string, ownerUid: string, bucket?: string): boolean {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_RECEIPT_URL_LENGTH) return false;
  if (!ownerUid) return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") return false;
  if (url.username || url.password) return false;

  // المسار الخام: /v0/b/<bucket>/o/receipts%2F<uid>%2F<file>
  const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
  if (!match) return false;
  if (bucket && match[1] !== bucket) return false;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return false;
  }
  if (objectPath.includes("..")) return false;
  return objectPath.startsWith(`receipts/${ownerUid}/`) && objectPath.length > `receipts/${ownerUid}/`.length;
}
