import { argon2idAsync } from "@noble/hashes/argon2.js";

import { base64UrlDecode, base64UrlEncode } from "./codec";
import { bytesEqual } from "./secrets";

/** OWASP Argon2id minimum: 19 MiB, 2 iterations, parallelism 1. */
export const ARGON2_MEMORY_KIB = 19_456;
export const ARGON2_TIME = 2;
export const ARGON2_PARALLELISM = 1;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 128;

const HASH_BYTES = 32;
const SALT_BYTES = 16;
const PHC =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

type ArgonParams = { m: number; t: number; p: number };
type ParsedHash = ArgonParams & { salt: Uint8Array; hash: Uint8Array };

let queue: Promise<void> = Promise.resolve();
let dummyHash: Promise<string> | null = null;

/** Noble's Argon2 uses one shared block buffer, so derivations run one at a time. */
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

export function paramsAcceptable(params: ArgonParams): boolean {
  if (
    !Number.isInteger(params.m) ||
    !Number.isInteger(params.t) ||
    !Number.isInteger(params.p)
  ) {
    return false;
  }
  if (params.p < 1) return false;
  const lowMemory = params.m >= ARGON2_MEMORY_KIB && params.t >= ARGON2_TIME;
  const highMemory = params.m >= 47_104 && params.t >= 1;
  return lowMemory || highMemory;
}

export function parsePasswordHash(stored: string): ParsedHash | null {
  const match = PHC.exec(stored);
  if (!match) return null;
  const params = { m: Number(match[1]), t: Number(match[2]), p: Number(match[3]) };
  if (!paramsAcceptable(params)) return null;
  const salt = base64UrlDecode(match[4]);
  const hash = base64UrlDecode(match[5]);
  if (!salt || salt.length < SALT_BYTES || salt.length > 64) return null;
  if (!hash || hash.length !== HASH_BYTES) return null;
  return { ...params, salt, hash };
}

async function derive(password: string, salt: Uint8Array, params: ArgonParams): Promise<Uint8Array> {
  return exclusive(() =>
    argon2idAsync(password, salt, {
      t: params.t,
      m: params.m,
      p: params.p,
      dkLen: HASH_BYTES,
      version: 0x13,
      asyncTick: 10,
    })
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (!passwordAcceptable(password)) throw new Error("password_rejected");
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const params = { m: ARGON2_MEMORY_KIB, t: ARGON2_TIME, p: ARGON2_PARALLELISM };
  const hash = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.m},t=${params.t},p=${params.p}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed || !passwordAcceptable(password)) return false;
  try {
    const actual = await derive(password, parsed.salt, parsed);
    return bytesEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

/** Spend a full Argon2id check so missing and wrong passwords take similar time. */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    dummyHash = hashPassword(base64UrlEncode(bytes));
  }
  const stored = await dummyHash;
  const probe = passwordAcceptable(password) ? password : base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  await verifyPassword(probe, stored);
}
