import { describe, expect, it } from "vitest";
import { evaluateOtp } from "../../functions/src/lib/otpDecision";
import { hashOtp } from "../../functions/src/lib/otp";

const future = { toMillis: () => Date.now() + 60_000 };
const past = { toMillis: () => Date.now() - 1 };
const rec = (otp: string, attempts = 0, expiresAt = future) => ({ hash: hashOtp(otp), expiresAt, attempts });

describe("evaluateOtp", () => {
  it("لا سجل → missing", () => expect(evaluateOtp(null, "123456", Date.now())).toBe("missing"));
  it("رمز صحيح → ok", () => expect(evaluateOtp(rec("123456"), "123456", Date.now())).toBe("ok"));
  it("رمز خاطئ → wrong", () => expect(evaluateOtp(rec("123456"), "654321", Date.now())).toBe("wrong"));
  it("منتهي الصلاحية → expired (حتى لو الرمز صحيح)", () =>
    expect(evaluateOtp(rec("123456", 0, past), "123456", Date.now())).toBe("expired"));
  it("بلوغ الحد الأقصى للمحاولات → locked (حتى لو الرمز صحيح)", () => {
    expect(evaluateOtp(rec("123456", 5), "123456", Date.now())).toBe("locked");
    expect(evaluateOtp(rec("123456", 4), "123456", Date.now())).toBe("ok");
  });
  it("attempts غير معرّف يُعامَل كصفر", () => {
    expect(evaluateOtp({ hash: hashOtp("111111"), expiresAt: future }, "111111", Date.now())).toBe("ok");
  });
});
