import { describe, expect, it } from "vitest";
import { isValidReceiptUrl } from "./receipt-url";

const BUCKET = "eleven-store.appspot.com";
const good = (uid: string, file = "1700000000.jpg") =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/receipts%2F${uid}%2F${file}?alt=media&token=abc-123`;

describe("isValidReceiptUrl", () => {
  it("يقبل رابط تنزيل Firebase Storage لإيصال صاحب الطلب", () => {
    expect(isValidReceiptUrl(good("u1"), "u1", BUCKET)).toBe(true);
    expect(isValidReceiptUrl(good("u1"), "u1")).toBe(true); // بدون فرض اسم الحاوية
  });
  it("يرفض إيصال مستخدم آخر", () => {
    expect(isValidReceiptUrl(good("u2"), "u1", BUCKET)).toBe(false);
  });
  it("يرفض حاوية مختلفة عند تحديدها", () => {
    expect(isValidReceiptUrl(good("u1").replace(BUCKET, "other.appspot.com"), "u1", BUCKET)).toBe(false);
  });
  it("يرفض مسارات خارج receipts/ (منتجات، بانرات...)", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/products%2Fx.jpg?alt=media`;
    expect(isValidReceiptUrl(url, "u1", BUCKET)).toBe(false);
  });
  it("يرفض المخططات والنطاقات الخارجية", () => {
    expect(isValidReceiptUrl("javascript:alert(1)", "u1")).toBe(false);
    expect(isValidReceiptUrl("data:text/html,<script>1</script>", "u1")).toBe(false);
    expect(isValidReceiptUrl("http://firebasestorage.googleapis.com/v0/b/b/o/receipts%2Fu1%2Fa.jpg", "u1")).toBe(false);
    expect(isValidReceiptUrl("https://evil.example/v0/b/b/o/receipts%2Fu1%2Fa.jpg", "u1")).toBe(false);
    expect(isValidReceiptUrl("https://firebasestorage.googleapis.com.evil.example/v0/b/b/o/receipts%2Fu1%2Fa.jpg", "u1")).toBe(false);
  });
  it("يرفض بيانات اعتماد داخل الرابط، والتسلل عبر ..، والمسار الفارغ", () => {
    expect(isValidReceiptUrl("https://user:pw@firebasestorage.googleapis.com/v0/b/b/o/receipts%2Fu1%2Fa.jpg", "u1")).toBe(false);
    expect(isValidReceiptUrl(good("u1", "..%2F..%2Fu2%2Fa.jpg"), "u1", BUCKET)).toBe(false);
    expect(isValidReceiptUrl(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/receipts%2Fu1%2F`, "u1", BUCKET)).toBe(false);
  });
  it("يرفض الفارغ والطويل جداً وuid فارغ", () => {
    expect(isValidReceiptUrl("", "u1")).toBe(false);
    expect(isValidReceiptUrl(good("u1", "a".repeat(3000)), "u1")).toBe(false);
    expect(isValidReceiptUrl(good("u1"), "")).toBe(false);
  });
});
