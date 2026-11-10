import { sha256Hex } from "./codec";
import {
  countLoginFailuresForEmail,
  countLoginFailuresForPair,
  deleteExpiredSessions,
  deleteOldLoginAttempts,
  deleteSessionByHash,
  deleteSessionsForOwner,
  getOwnerByEmail,
  getOwnerById,
  getPasswordHash,
  getSessionByHash,
  insertLoginAttempt,
  insertSession,
  ownerJson,
  updatePasswordHash,
} from "./db";
import type { PortalD1 } from "./d1";
import { normalizeLoginEmail } from "./email";
import type { PortalEnv } from "./env";
import { clientIp, devAuthEmail, originAllowed, requestHost, sessionHostAllowed } from "./hosts";
import {
  forbidden,
  INVALID_CREDENTIALS,
  json,
  rateLimited,
  readJson,
  unauthorized,
  validationError,
} from "./http";
import { configuredPepper, decodeDerived, macMatches, sealDerived } from "./mac";
import { secretsEqual } from "./secrets";
import {
  applyCookies,
  clearSessionCookie,
  newSessionSecrets,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
} from "./session";
import type { PortalAuth } from "./types";

/** Failed attempts for one email from one IP. Successes are not counted. */
export const PAIR_FAILURE_LIMIT = 20;
/** Email-wide cap, high enough that strangers cannot lock the public address. */
export const EMAIL_FAILURE_LIMIT = 200;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const INVALID_ATTEMPT_EMAIL = "invalid";
const SETUP_ATTEMPT_EMAIL = "setup";

function invalidCredentials(): Response {
  return json(INVALID_CREDENTIALS, 401);
}

function authUnconfigured(): Response {
  return json({ error: "auth_unconfigured" }, 500);
}

export { normalizeLoginEmail } from "./email";

export async function requireCsrf(
  request: Request,
  auth: PortalAuth
): Promise<Response | null> {
  if (auth.devBypass) return null;
  if (!originAllowed(request)) return forbidden("csrf");
  const sent = request.headers.get("x-csrf-token") ?? "";
  if (!(await secretsEqual(sent, auth.csrfToken))) return forbidden("csrf");
  return null;
}

async function overFailureLimit(
  db: PortalD1,
  email: string,
  ip: string,
  cutoffIso: string
): Promise<boolean> {
  const [pair, byEmail] = await Promise.all([
    countLoginFailuresForPair(db, email, ip, cutoffIso),
    countLoginFailuresForEmail(db, email, cutoffIso),
  ]);
  return pair >= PAIR_FAILURE_LIMIT || byEmail >= EMAIL_FAILURE_LIMIT;
}

async function recordFailure(db: PortalD1, email: string, ip: string, nowIso: string): Promise<void> {
  await insertLoginAttempt(db, email, ip, nowIso);
}

export async function authenticate(
  request: Request,
  env: PortalEnv,
  db: PortalD1,
  now = new Date()
): Promise<PortalAuth | Response> {
  const host = requestHost(request);
  if (!sessionHostAllowed(host)) return unauthorized();

  const devEmail = devAuthEmail(request, env);
  if (devEmail) {
    const row = await getOwnerByEmail(db, devEmail);
    if (!row) return forbidden("unknown_email", devEmail);
    return {
      email: row.email.trim().toLowerCase(),
      owner: ownerJson(row, env),
      csrfToken: "",
      devBypass: true,
    };
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return unauthorized();
  const nowIso = now.toISOString();
  await deleteExpiredSessions(db, nowIso);
  const idHash = await sha256Hex(token);
  const session = await getSessionByHash(db, idHash);
  if (!session || session.expires_at <= nowIso) {
    if (session) await deleteSessionByHash(db, idHash);
    return unauthorized();
  }
  const row = await getOwnerById(db, Number(session.owner_id));
  if (!row) {
    await deleteSessionByHash(db, idHash);
    return unauthorized();
  }
  return {
    email: row.email.trim().toLowerCase(),
    owner: ownerJson(row, env),
    csrfToken: session.csrf_secret,
    devBypass: false,
  };
}

export async function handleLogin(
  request: Request,
  env: PortalEnv,
  db: PortalD1,
  now = new Date()
): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const host = requestHost(request);
  if (!sessionHostAllowed(host)) return forbidden("host_not_allowed");
  if (!originAllowed(request)) return forbidden("csrf");
  const pepper = configuredPepper(env);
  if (!pepper) return authUnconfigured();

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return json({ error: "invalid_json" }, 400);
  }
  const record = body.value as Record<string, unknown>;
  if (typeof record.email !== "string" || typeof record.derived !== "string") {
    return validationError({ form: "Enter your email and password." });
  }

  const email = normalizeLoginEmail(record.email);
  const derived = decodeDerived(record.derived);
  const attemptEmail = email ?? INVALID_ATTEMPT_EMAIL;
  const ip = clientIp(request);
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  await deleteOldLoginAttempts(db, cutoff);
  if (await overFailureLimit(db, attemptEmail, ip, cutoff)) {
    await recordFailure(db, attemptEmail, ip, nowIso);
    return rateLimited();
  }

  const owner = email ? await getOwnerByEmail(db, email) : null;
  const stored = owner ? await getPasswordHash(db, Number(owner.id)) : null;
  const matches = await macMatches(pepper, derived, stored);
  if (!email || !derived || !owner || !matches) {
    await recordFailure(db, attemptEmail, ip, nowIso);
    return invalidCredentials();
  }

  const presented = readCookie(request, SESSION_COOKIE);
  if (presented) await deleteSessionByHash(db, await sha256Hex(presented));
  const secrets = newSessionSecrets();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await insertSession(
    db,
    await sha256Hex(secrets.token),
    Number(owner.id),
    secrets.csrfToken,
    expiresAt,
    nowIso
  );
  const response = json({
    email: owner.email.trim().toLowerCase(),
    owner: ownerJson(owner, env),
    csrfToken: secrets.csrfToken,
  });
  return applyCookies(response, [sessionCookie(secrets.token)]);
}

export async function handleLogout(
  request: Request,
  db: PortalD1,
  auth: PortalAuth
): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const denied = await requireCsrf(request, auth);
  if (denied) return denied;
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await deleteSessionByHash(db, await sha256Hex(token));
  return applyCookies(json({ ok: true }), [clearSessionCookie()]);
}

function setupConfigured(env: PortalEnv): string | null {
  const token = env.PORTAL_SETUP_TOKEN?.trim() ?? "";
  if (!token) return null;
  return token;
}

export async function handleSetupPassword(
  request: Request,
  env: PortalEnv,
  db: PortalD1,
  now = new Date()
): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const expected = setupConfigured(env);
  if (!expected) return json({ error: "not_found" }, 404);
  if (!sessionHostAllowed(requestHost(request))) return forbidden("host_not_allowed");
  const pepper = configuredPepper(env);
  if (!pepper) return authUnconfigured();

  const ip = clientIp(request);
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  await deleteOldLoginAttempts(db, cutoff);
  if (await overFailureLimit(db, SETUP_ATTEMPT_EMAIL, ip, cutoff)) {
    await recordFailure(db, SETUP_ATTEMPT_EMAIL, ip, nowIso);
    return rateLimited();
  }

  const provided = request.headers.get("x-portal-setup-token") ?? "";
  if (!(await secretsEqual(provided, expected))) {
    await recordFailure(db, SETUP_ATTEMPT_EMAIL, ip, nowIso);
    return unauthorized();
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return json({ error: "invalid_json" }, 400);
  }
  const record = body.value as Record<string, unknown>;
  if ("password" in record) {
    return validationError({ derived: "Send the derived key." });
  }
  const email = normalizeLoginEmail(record.email);
  const derived = decodeDerived(record.derived);
  if (!email) return validationError({ email: "Enter a valid email." });
  if (!derived) return validationError({ derived: "Send the derived key." });
  const owner = await getOwnerByEmail(db, email);
  if (!owner) return json({ error: "setup_failed" }, 400);

  await updatePasswordHash(db, Number(owner.id), await sealDerived(pepper, derived));
  await deleteSessionsForOwner(db, Number(owner.id));
  return json({ ok: true });
}
