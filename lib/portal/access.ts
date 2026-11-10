import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

import type { PortalEnv } from "./env";

const TEAM_HOST = /^[a-z0-9.-]+$/;
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class AccessJwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessJwtError";
  }
}

export function clearAccessJwksCache(): void {
  jwksCache.clear();
}

/** Team name or `*.cloudflareaccess.com` host, with or without https://. */
export function accessIssuer(teamDomain: string): { issuer: string; certsUrl: string } {
  const raw = teamDomain.trim();
  if (!raw) throw new AccessJwtError("missing team domain");
  const host = raw
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!host || !TEAM_HOST.test(host)) {
    throw new AccessJwtError("bad team domain");
  }
  const fqdn = host.includes(".") ? host : `${host}.cloudflareaccess.com`;
  if (!fqdn.endsWith(".cloudflareaccess.com")) {
    throw new AccessJwtError("team domain must be a cloudflareaccess.com host");
  }
  return {
    issuer: `https://${fqdn}`,
    certsUrl: `https://${fqdn}/cdn-cgi/access/certs`,
  };
}

export function audiencesFromEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function emailFromPayload(payload: JWTPayload): string | null {
  const value = payload.email;
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

export async function verifyAccessJwt(
  token: string,
  env: PortalEnv,
  key?: CryptoKey | JWTVerifyGetKey
): Promise<string> {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audiences = audiencesFromEnv(env.CF_ACCESS_AUD);
  if (!team || audiences.length === 0) {
    throw new AccessJwtError("access is not configured");
  }
  const { issuer, certsUrl } = accessIssuer(team);
  let resolver = key;
  if (!resolver) {
    let cached = jwksCache.get(certsUrl);
    if (!cached) {
      cached = createRemoteJWKSet(new URL(certsUrl));
      jwksCache.set(certsUrl, cached);
    }
    resolver = cached;
  }
  const { payload } = await jwtVerify(token, resolver, {
    issuer,
    audience: audiences.length === 1 ? audiences[0] : audiences,
    algorithms: ["RS256"],
    clockTolerance: 30,
  });
  const email = emailFromPayload(payload);
  if (!email) throw new AccessJwtError("missing email");
  return email;
}

function requestHost(request: Request): string {
  try {
    return new URL(request.url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** Live site and Pages hostnames never honor the dev bypass. */
export function isLockedAuthHost(host: string): boolean {
  if (!host) return true;
  if (host === "panamericafleet.com" || host === "www.panamericafleet.com") {
    return true;
  }
  if (host.endsWith(".panamericafleet.com")) return true;
  if (host === "pages.dev" || host.endsWith(".pages.dev")) return true;
  return false;
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
