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

export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (cf.length > 0 && cf.length <= 64 && /^[a-fA-F0-9:.]+$/.test(cf)) {
    return cf.toLowerCase();
  }
  return "unknown";
}
