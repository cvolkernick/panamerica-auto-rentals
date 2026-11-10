import { base64UrlDecode, base64UrlEncode } from "./codec";
import type { PortalEnv } from "./env";
import { bytesEqual } from "./secrets";

/** HMAC of the browser-derived key. This is the only password check the Worker runs. */
export const MAC_PREFIX = "hmac-sha256$";
export const DERIVED_BYTES = 32;
export const SERVER_AUTH_BUDGET_MS = 10;
const MIN_PEPPER_LENGTH = 32;
const ZEROS = new Uint8Array(DERIVED_BYTES);

export function configuredPepper(env: PortalEnv): string | null {
  const pepper = env.PORTAL_PEPPER?.trim() ?? "";
  if (pepper.length < MIN_PEPPER_LENGTH) return null;
  return pepper;
}

export function decodeDerived(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const bytes = base64UrlDecode(value);
  if (!bytes || bytes.length !== DERIVED_BYTES) return null;
  return bytes;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function macDerived(pepper: string, derived: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, copyBytes(derived));
  return new Uint8Array(signed);
}

export async function sealDerived(pepper: string, derived: Uint8Array): Promise<string> {
  return MAC_PREFIX + base64UrlEncode(await macDerived(pepper, derived));
}

/** Always HMACs and compares 32 bytes, including when the account or the stored value is missing. */
export async function macMatches(
  pepper: string,
  derived: Uint8Array | null,
  stored: string | null
): Promise<boolean> {
  const actual = await macDerived(pepper, derived ?? ZEROS);
  const encoded = stored?.startsWith(MAC_PREFIX) ? stored.slice(MAC_PREFIX.length) : "";
  const decoded = encoded ? base64UrlDecode(encoded) : null;
  const expected = decoded && decoded.length === actual.length ? decoded : ZEROS;
  const equal = bytesEqual(actual, expected);
  return Boolean(derived && stored && decoded && decoded.length === actual.length && equal);
}
