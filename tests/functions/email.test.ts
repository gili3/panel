import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../../functions/src/lib/email";

describe("normalizeEmail", () => {
  it("يحوّل العنوان كاملاً لأحرف صغيرة (Firebase Auth لا يفرّق بين الحالات)", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com");
    expect(normalizeEmail("USER@example.com")).toBe(normalizeEmail("user@EXAMPLE.com"));
  });

  it("يزيل المسافات المحيطة", () => {
    expect(normalizeEmail("  a@b.com \n")).toBe("a@b.com");
  });

  it("Gmail/Googlemail: يحذف النقاط من الجزء المحلي فقط", () => {
    expect(normalizeEmail("Yxr.249@Gmail.com")).toBe("yxr249@gmail.com");
    expect(normalizeEmail("a.b.c@googlemail.com")).toBe("abc@googlemail.com");
  });

  it("نطاقات أخرى: النقاط تبقى كما هي", () => {
    expect(normalizeEmail("first.last@company.com")).toBe("first.last@company.com");
  });

  it("علامة + لا تُعالَج", () => {
    expect(normalizeEmail("a.b+tag@gmail.com")).toBe("ab+tag@gmail.com");
  });

  it("مدخل بلا @ أو فارغ لا يرمي خطأ", () => {
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail("Not-An-Email")).toBe("not-an-email");
    expect(normalizeEmail("@x.com")).toBe("@x.com");
  });
});
