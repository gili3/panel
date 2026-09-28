import { describe, expect, it } from "vitest";
import { redactSensitive } from "./redact";

describe("redactSensitive", () => {
  it("يخفي JWT كاملاً", () => {
    const jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJhYmMxMjMifQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU";
    const out = redactSensitive(`فشل الطلب مع ${jwt} انتهى`);
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("[JWT]");
  });
  it("يخفي Bearer وقيم token/password/otp في الروابط وJSON", () => {
    expect(redactSensitive("Authorization: Bearer abcDEF123456789xyz")).not.toContain("abcDEF123456789xyz");
    expect(redactSensitive("GET /o/a.jpg?alt=media&token=8f3a-77aa-99")).not.toContain("8f3a-77aa-99");
    expect(redactSensitive('{"password":"hunter2hunter2","x":1}')).not.toContain("hunter2hunter2");
    expect(redactSensitive("otp=123456")).not.toContain("123456");
  });
  it("يخفي السلاسل الطويلة المتصلة (توكن FCM / كوكي جلسة)", () => {
    const long = "dGhpcyBpcyBhIHZlcnkgbG9uZyB0b2tlbg:APA91b" + "x".repeat(120);
    expect(redactSensitive(`token failure ${long}`)).not.toContain("xxxxxxxxxxxxxxxxxxxx");
  });
  it("لا يمسّ رسائل الخطأ العادية ومسارات الملفات", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'items') at CartScreen.kt:120";
    expect(redactSensitive(msg)).toBe(msg);
    expect(redactSensitive("")).toBe("");
  });
});
