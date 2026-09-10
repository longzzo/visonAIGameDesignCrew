const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http://127.0.0.1:11434",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export function hostnameAllowed(hostname, extraHosts = []) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true;
  if (h.endsWith(".ts.net")) return true;
  return extraHosts.some((value) => h === value || h.endsWith(`.${value}`));
}

/** 브라우저 쓰기 요청은 허용 호스트일 뿐 아니라 현재 Host와 Origin이 정확히 같아야 한다. */
export function originMatchesRequest(origin, requestHost, extraHosts = []) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && hostnameAllowed(parsed.hostname, extraHosts)
      && parsed.host.toLowerCase() === String(requestHost || "").toLowerCase();
  } catch {
    return false;
  }
}

export function applySecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", DEFAULT_CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}
