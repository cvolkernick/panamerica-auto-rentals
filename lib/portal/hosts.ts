import type { PortalEnv } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function requestHost(request: Request): string {
  try {
    return new URL(request.url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isPagesDevHost(host: string): boolean {
  return host === "pages.dev" || host.endsWith(".pages.dev");
}

export function isApexHost(host: string): boolean {
  return host === "panamericafleet.com";
}

/** Live site and Pages hostnames never honor the dev bypass. */
export function isLockedAuthHost(host: string): boolean {
  if (!host) return true;
  if (host === "panamericafleet.com" || host === "www.panamericafleet.com") return true;
  if (host.endsWith(".panamericafleet.com")) return true;
  if (isPagesDevHost(host)) return true;
  return false;
}

/**
 * Sessions are host-only (__Host- cookies cannot set Domain).
 * The apex redirects portal paths to www. Local hosts are for wrangler.
 */
export function sessionHostAllowed(host: string): boolean {
  if (host === "www.panamericafleet.com") return true;
  return LOCAL_HOSTS.has(host);
}

export function isPortalSurface(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return (
    path === "/owner" ||
    path.startsWith("/owner/") ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/portal" ||
    path.startsWith("/api/portal/")
  );
}

/** 308 only portal paths from the apex to www. Public pages are left alone. */
export function portalApexRedirect(request: Request): Response | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isApexHost(host) || !isPortalSurface(url.pathname)) return null;
  url.hostname = "www.panamericafleet.com";
  url.protocol = "https:";
  return Response.redirect(url.toString(), 308);
}

/**
 * Local/test only. Requires PORTAL_DEV_AUTH exactly "1".
 * Off unless that flag is set, and ignored on production and pages.dev hosts.
 */
export function devAuthEmail(request: Request, env: PortalEnv): string | null {
  if (env.PORTAL_DEV_AUTH !== "1") return null;
  if (isLockedAuthHost(requestHost(request))) return null;
  const email = (env.PORTAL_DEV_EMAIL ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

export function originAllowed(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.host.toLowerCase() !== requestUrl.host.toLowerCase()) return false;
  const host = requestUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (LOCAL_HOSTS.has(host)) {
    return originUrl.protocol === "http:" || originUrl.protocol === "https:";
  }
  return originUrl.protocol === "https:";
}

function ipv4Key(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (numbers.some((number) => !Number.isInteger(number) || number > 255)) return null;
  return numbers.join(".");
}

/** First 64 bits of an IPv6 address, or null when the text is not an address. */
function ipv6Prefix64(ip: string): string | null {
  if (ip.includes("%") || (ip.match(/::/g) ?? []).length > 1) return null;
  const halves = ip.split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if ([...head, ...tail].some((part) => part.includes("."))) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => (/^[a-f0-9]{1,4}$/.test(group) ? Number.parseInt(group, 16) : NaN));
  if (parsed.some((number) => !Number.isInteger(number) || number > 0xffff)) return null;
  return parsed
    .slice(0, 4)
    .map((number) => number.toString(16))
    .join(":");
}

/**
 * Rate-limit key. IPv4 stays the full address. IPv6 is the /64 so a subnet
 * cannot rotate host bits past the per-address cap.
 */
export function rateLimitIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  if (!ip || ip.length > 64 || !/^[a-f0-9:.]+$/.test(ip)) return "unknown";
  const v4 = ipv4Key(ip);
  if (v4) return v4;
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4Key(mapped[1]) ?? "unknown";
  const prefix = ipv6Prefix64(ip);
  return prefix ? `${prefix}::/64` : "unknown";
}

export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!cf) return "unknown";
  return rateLimitIp(cf);
}
