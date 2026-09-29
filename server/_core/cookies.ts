import type { CookieOptions, Request } from "express";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- مستخدم بالكود المعلَّق أدناه
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- مستخدم بالكود المعلَّق أدناه
function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  const secure = isSecureRequest(req);
  // ✅ SameSite=None يتطلب Secure إلزامياً (تتجاهله المتصفحات الحديثة بدونه)،
  // فيفشل حفظ الكوكي بصمت أثناء التطوير المحلي عبر http. نستخدم "none" فقط
  // مع https (يلزم لدعم Capacitor/origins مختلفة)، و"lax" مع http العادي.
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
