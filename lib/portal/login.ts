import { sha256Hex } from "./codec";
import {
  countLoginAttempts,
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
import { burnPasswordCheck, hashPassword, parsePasswordHash, passwordAcceptable, verifyPassword } from "./password";
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

export const EMAIL_ATTEMPT_LIMIT = 8;
export const IP_ATTEMPT_LIMIT = 20;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const INVALID_ATTEMPT_EMAIL = "invalid";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidCredentials(): Response {
  return json(INVALID_CREDENTIALS, 401);
}

export function normalizeLoginEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

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

async function limited(db: PortalD1, email: string, ip: string, cutoffIso: string): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([
    countLoginAttempts(db, "email", email, cutoffIso),
    countLoginAttempts(db, "ip", ip, cutoffIso),
  ]);
  return byEmail >= EMAIL_ATTEMPT_LIMIT || byIp >= IP_ATTEMPT_LIMIT;
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

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return json({ error: "invalid_json" }, 400);
  }
  const record = body.value as Record<string, unknown>;
  if (typeof record.email !== "string" || typeof record.password !== "string") {
    return validationError({ form: "Enter your email and password." });
  }

  const email = normalizeLoginEmail(record.email);
  const password = record.password;
  const attemptEmail = email ?? INVALID_ATTEMPT_EMAIL;
  const ip = clientIp(request);
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  await deleteOldLoginAttempts(db, cutoff);
  if (await limited(db, attemptEmail, ip, cutoff)) {
    await insertLoginAttempt(db, attemptEmail, ip, now.toISOString());
    return rateLimited();
  }
  await insertLoginAttempt(db, attemptEmail, ip, now.toISOString());

  const acceptable = passwordAcceptable(password);
  if (!email || !acceptable) {
    await burnPasswordCheck(password);
    return invalidCredentials();
  }

  const owner = await getOwnerByEmail(db, email);
  const stored = owner ? await getPasswordHash(db, Number(owner.id)) : null;
  if (!owner || !stored || !parsePasswordHash(stored)) {
    await burnPasswordCheck(password);
    return invalidCredentials();
  }
  const matches = await verifyPassword(password, stored);
  if (!matches) return invalidCredentials();

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
    now.toISOString()
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

  const ip = clientIp(request);
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  const setupKey = `setup:${ip}`;
  await deleteOldLoginAttempts(db, cutoff);
  if (await limited(db, setupKey, ip, cutoff)) {
    await insertLoginAttempt(db, setupKey, ip, now.toISOString());
    return rateLimited();
  }
  await insertLoginAttempt(db, setupKey, ip, now.toISOString());

  const provided = request.headers.get("x-portal-setup-token") ?? "";
  if (!(await secretsEqual(provided, expected))) return unauthorized();

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return json({ error: "invalid_json" }, 400);
  }
  const record = body.value as Record<string, unknown>;
  const email = normalizeLoginEmail(record.email);
  if (!email) return validationError({ email: "Enter a valid email." });
  if (typeof record.password !== "string" || !passwordAcceptable(record.password)) {
    return validationError({ password: "Use 12 to 128 characters." });
  }
  const owner = await getOwnerByEmail(db, email);
  if (!owner) return json({ error: "setup_failed" }, 400);

  const passwordHash = await hashPassword(record.password);
  await updatePasswordHash(db, Number(owner.id), passwordHash);
  await deleteSessionsForOwner(db, Number(owner.id));
  return json({ ok: true });
}
