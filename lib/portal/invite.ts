import { randomToken, sha256Hex } from "./codec";
import {
  claimOwnerInvite,
  countLoginFailuresForIpv6Prefix,
  countLoginFailuresForPair,
  deleteOldLoginAttempts,
  deleteSessionsForOwner,
  getOwnerById,
  getOwnerInviteByHash,
  insertLoginAttempt,
  insertOwnerInvite,
  invalidateUnusedInvites,
  updatePasswordHash,
  type OwnerInviteRow,
} from "./db";
import type { PortalD1 } from "./d1";
import type { PortalEnv } from "./env";
import { clientIp, ipv6Prefix48, originAllowed, requestHost, sessionHostAllowed } from "./hosts";
import { forbidden, json, rateLimited, readJson, validationError } from "./http";
import { ATTEMPT_WINDOW_MS, PAIR_FAILURE_LIMIT, PREFIX48_FAILURE_LIMIT } from "./login";
import { configuredPepper, decodeDerived, sealDerived } from "./mac";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Shared bucket so invite guesses do not lock a real owner email, and one network cannot exhaust a global cap. */
export const INVITE_ATTEMPT_EMAIL = "invite";
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITE_URL_PREFIX = "https://www.panamericafleet.com/owner/invite/?t=";

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

function inviteInvalid(): Response {
  return json({ error: "invite_invalid" }, 400);
}

function authUnconfigured(): Response {
  return json({ error: "auth_unconfigured" }, 500);
}

async function recordFailure(db: PortalD1, ip: string, nowIso: string): Promise<void> {
  await insertLoginAttempt(db, INVITE_ATTEMPT_EMAIL, ip, nowIso);
}

async function inviteLimited(db: PortalD1, ip: string, cutoffIso: string): Promise<boolean> {
  await deleteOldLoginAttempts(db, cutoffIso);
  if ((await countLoginFailuresForPair(db, INVITE_ATTEMPT_EMAIL, ip, cutoffIso)) >= PAIR_FAILURE_LIMIT) {
    return true;
  }
  const prefix48 = ipv6Prefix48(ip);
  if (!prefix48) return false;
  const inNetwork = await countLoginFailuresForIpv6Prefix(db, INVITE_ATTEMPT_EMAIL, prefix48, cutoffIso);
  return inNetwork >= PREFIX48_FAILURE_LIMIT;
}

function inviteUsable(row: OwnerInviteRow | null, nowIso: string): row is OwnerInviteRow {
  return row != null && row.used_at == null && row.expires_at > nowIso;
}

export async function createOwnerInvite(
  db: PortalD1,
  ownerId: number,
  now = new Date()
): Promise<Response> {
  const owner = await getOwnerById(db, ownerId);
  if (!owner) return json({ error: "not_found" }, 404);
  const token = randomToken(32);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  await invalidateUnusedInvites(db, ownerId, createdAt);
  await insertOwnerInvite(db, await sha256Hex(token), ownerId, createdAt, expiresAt);
  return json({ url: `${INVITE_URL_PREFIX}${token}`, expiresAt }, 201);
}

async function rejectInvite(
  db: PortalD1,
  ip: string,
  nowIso: string
): Promise<Response> {
  await recordFailure(db, ip, nowIso);
  return inviteInvalid();
}

export async function handleInvite(
  request: Request,
  env: PortalEnv,
  db: PortalD1,
  now = new Date()
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
  }
  if (!sessionHostAllowed(requestHost(request))) return forbidden("host_not_allowed");
  const pepper = configuredPepper(env);
  if (!pepper) return authUnconfigured();
  if (method === "POST" && !originAllowed(request)) return forbidden("csrf");

  const url = new URL(request.url);
  const ip = clientIp(request);
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  if (await inviteLimited(db, ip, cutoff)) return rateLimited();

  if (method === "GET") {
    const token = url.searchParams.get("t") ?? "";
    if (!INVITE_TOKEN_PATTERN.test(token)) return rejectInvite(db, ip, nowIso);
    const row = await getOwnerInviteByHash(db, await sha256Hex(token));
    if (!inviteUsable(row, nowIso)) return rejectInvite(db, ip, nowIso);
    const owner = await getOwnerById(db, Number(row.owner_id));
    if (!owner) return rejectInvite(db, ip, nowIso);
    const email = owner.email.trim().toLowerCase();
    return json({ email, emailMasked: maskEmail(email) });
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return json({ error: "invalid_json" }, 400);
  }
  const record = body.value as Record<string, unknown>;
  if ("password" in record) {
    await recordFailure(db, ip, nowIso);
    return validationError({ derived: "Send the derived key." });
  }
  const token = typeof record.token === "string" ? record.token : "";
  const derived = decodeDerived(record.derived);
  if (!INVITE_TOKEN_PATTERN.test(token) || !derived) return rejectInvite(db, ip, nowIso);

  const tokenHash = await sha256Hex(token);
  const claimed = await claimOwnerInvite(db, tokenHash, nowIso, nowIso);
  if (!claimed) return rejectInvite(db, ip, nowIso);
  const row = await getOwnerInviteByHash(db, tokenHash);
  const owner = row ? await getOwnerById(db, Number(row.owner_id)) : null;
  if (!owner) return inviteInvalid();
  await updatePasswordHash(db, Number(owner.id), await sealDerived(pepper, derived));
  await deleteSessionsForOwner(db, Number(owner.id));
  return json({ ok: true });
}
