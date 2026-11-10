import { argon2id } from "hash-wasm";

import { base64UrlEncode } from "./codec";

/**
 * Browser-only Argon2id. Pages Functions must not import this module.
 * The salt is SHA-256(prefix + email), so it is fixed per email and is not a lookup.
 */
export const PORTAL_SALT_PREFIX = "panamericafleet.com/portal-v1";
export const ARGON2_MEMORY_KIB = 19_456;
export const ARGON2_TIME = 2;
export const ARGON2_PARALLELISM = 1;
export const DERIVED_BYTES = 32;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 128;

let queue: Promise<void> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function passwordAcceptable(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH || password.includes("\0")) return false;
  return new TextEncoder().encode(password).byteLength <= PASSWORD_MAX_BYTES;
}

export async function portalSalt(email: string): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`${PORTAL_SALT_PREFIX}\0${email}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

export async function derivePortalKey(email: string, password: string): Promise<Uint8Array> {
  const salt = await portalSalt(email);
  return exclusive(() =>
    argon2id({
      password,
      salt,
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_TIME,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: DERIVED_BYTES,
      outputType: "binary",
    })
  );
}

export function encodeDerived(derived: Uint8Array): string {
  return base64UrlEncode(derived);
}
