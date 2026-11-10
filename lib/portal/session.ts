import { randomToken } from "./codec";

/** __Host- forbids a Domain attribute. Portal paths on the apex redirect to www. */
export const SESSION_COOKIE = "__Host-portal_session";
/** Set after a successful login so that browser can skip the email-wide failure cap. */
export const DEVICE_COOKIE = "__Host-portal_device";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
export const DEVICE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function deviceCookie(token: string): string {
  return `${DEVICE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${DEVICE_MAX_AGE_SECONDS}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    return value;
  }
  return null;
}

export function newSessionSecrets(): { token: string; csrfToken: string } {
  return { token: randomToken(32), csrfToken: randomToken(32) };
}

export function applyCookies(response: Response, cookies: string[]): Response {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}
