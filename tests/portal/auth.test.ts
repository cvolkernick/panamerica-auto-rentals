import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";

import { onRequest as apexMiddleware } from "../../functions/_middleware";
import { base64UrlEncode, randomToken, sha256Hex } from "../../lib/portal/codec";
import {
  getOwnerByEmail,
  getPasswordHash,
  insertLoginAttempt,
  insertSession,
  updatePasswordHash,
} from "../../lib/portal/db";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import {
  ATTEMPT_WINDOW_MS,
  EMAIL_ATTEMPT_LIMIT,
  IP_ATTEMPT_LIMIT,
} from "../../lib/portal/login";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../lib/portal/password";
import { SESSION_COOKIE } from "../../lib/portal/session";
import { argon2id } from "@noble/hashes/argon2.js";
import { createMemoryD1 } from "./memory-d1";

const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";
const VIN_A = "1TSTCAR0000000001";
const VIN_B = "2TSTCAR0000000002";

let password = "";
let passwordHash = "";

before(async () => {
  password = randomBytes(18).toString("base64url");
  assert.ok(password.length >= PASSWORD_MIN_LENGTH);
  passwordHash = await hashPassword(password);
  assert.match(passwordHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
});

function env(extra: Partial<PortalEnv> = {}): PortalEnv {
  return { DB: createMemoryD1(), ...extra };
}

function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    host?: string;
    headers?: Record<string, string>;
    cookie?: string;
    origin?: string | null;
  } = {}
): Request {
  const host = options.host ?? "http://127.0.0.1";
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin === undefined) headers.set("origin", host);
  else if (options.origin) headers.set("origin", options.origin);
  return new Request(`${host}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function send(
  portal: PortalEnv,
  method: string,
  path: string,
  options: Parameters<typeof request>[2] = {}
) {
  const response = await handlePortal(request(method, path, options), portal);
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    text,
    headers: response.headers,
    setCookie: response.headers.getSetCookie(),
  };
}

function sessionPair(setCookie: string[]): string {
  const raw = setCookie.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(raw);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /Secure/);
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Path=\//);
  assert.match(raw, /Max-Age=604800/);
  assert.doesNotMatch(raw, /Domain=/i);
  return raw.split(";")[0];
}

async function login(
  portal: PortalEnv,
  email: string,
  secret: string,
  host = "http://127.0.0.1",
  headers?: Record<string, string>
) {
  return send(portal, "POST", "/api/portal/login", {
    body: { email, password: secret },
    host,
    headers,
  });
}

describe("password login", { concurrency: 1 }, () => {
  test("login sets a revocable 7-day session and logout deletes it", async () => {
    const portal = env();
    assert.equal(await getPasswordHash(portal.DB!, 1), null);
    const open = await send(portal, "GET", "/api/portal/session", { origin: null });
    assert.equal(open.status, 401);
    assert.equal((await send(portal, "GET", "/api/portal/cars", { origin: null })).status, 401);
    assert.equal((await send(portal, "GET", "/api/portal/admin/owners", { origin: null })).status, 401);

    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const signed = await login(portal, PANAMERICA, password);
    assert.equal(signed.status, 200);
    assert.equal(signed.text.includes(password), false);
    assert.equal(signed.text.includes("argon2"), false);
    assert.equal(signed.text.includes("password_hash"), false);
    assert.equal((signed.data?.owner as { email: string; isAdmin: boolean }).email, PANAMERICA);
    assert.equal((signed.data?.owner as { isAdmin: boolean }).isAdmin, true);
    const cookie = sessionPair(signed.setCookie);
    const csrf = signed.data?.csrfToken;
    assert.equal(typeof csrf, "string");
    assert.ok(csrf);

    const session = await send(portal, "GET", "/api/portal/session", { cookie, origin: null });
    assert.equal(session.status, 200);
    assert.equal(session.data?.email, PANAMERICA);
    const cars = await send(portal, "GET", "/api/portal/cars", { cookie, origin: null });
    assert.deepEqual(cars.data?.cars, []);

    const row = await portal.DB!.prepare(`SELECT expires_at FROM sessions`).bind().first<{
      expires_at: string;
    }>();
    const remaining = Date.parse(row!.expires_at) - Date.now();
    assert.ok(remaining > 6.5 * 24 * 60 * 60 * 1000);
    assert.ok(remaining < 7.5 * 24 * 60 * 60 * 1000);

    const again = await login(portal, PANAMERICA, password, "http://127.0.0.1", {
      cookie,
    });
    assert.equal(again.status, 200);
    const rotated = sessionPair(again.setCookie);
    assert.notEqual(rotated, cookie);
    assert.equal((await send(portal, "GET", "/api/portal/cars", { cookie, origin: null })).status, 401);
    assert.equal((await send(portal, "GET", "/api/portal/cars", { cookie: rotated, origin: null })).status, 200);
    const sessions = await portal.DB!.prepare(`SELECT COUNT(*) AS n FROM sessions`).bind().first<{
      n: number;
    }>();
    assert.equal(Number(sessions?.n), 1);

    const loggedOut = await send(portal, "POST", "/api/portal/logout", {
      cookie: rotated,
      headers: { "x-csrf-token": String(again.data?.csrfToken) },
    });
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.setCookie.join("\n"), /Max-Age=0/);
    const left = await portal.DB!.prepare(`SELECT COUNT(*) AS n FROM sessions`).bind().first<{
      n: number;
    }>();
    assert.equal(Number(left?.n), 0);
    assert.equal((await send(portal, "GET", "/api/portal/session", { cookie: rotated, origin: null })).status, 401);
  });

  test("unknown email and a bad password return the same error", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const bad = await login(portal, PANAMERICA, `${password}no`);
    const unknown = await login(portal, "nobody@example.com", password);
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(bad.data, { error: "invalid_credentials" });
    assert.deepEqual(unknown.data, bad.data);
    assert.equal(bad.setCookie.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.includes("Max-Age=0")), false);
    assert.equal(unknown.setCookie.length, 0);
    assert.equal(bad.text.includes(PANAMERICA), false);
    assert.equal(unknown.text.includes("nobody@example.com"), false);
  });

  test("login is limited by email and by IP", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const emailIp = "203.0.113.10";
    for (let i = 0; i < EMAIL_ATTEMPT_LIMIT; i++) {
      await insertLoginAttempt(portal.DB!, PANAMERICA, emailIp, new Date().toISOString());
    }
    const lockedEmail = await login(portal, PANAMERICA, password, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.11",
      "x-forwarded-for": "198.51.100.20",
    });
    const lockedUnknown = await login(portal, "nobody@example.com", password, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.11",
    });
    await insertLoginAttempt(portal.DB!, "nobody@example.com", "203.0.113.11", new Date().toISOString());
    for (let i = 1; i < EMAIL_ATTEMPT_LIMIT; i++) {
      await insertLoginAttempt(portal.DB!, "nobody@example.com", "203.0.113.11", new Date().toISOString());
    }
    const lockedUnknownNow = await login(portal, "nobody@example.com", password, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.12",
    });
    assert.equal(lockedEmail.status, 429);
    assert.deepEqual(lockedEmail.data, { error: "rate_limited" });
    assert.equal(lockedUnknown.status, 401);
    assert.equal(lockedUnknownNow.status, 429);
    assert.deepEqual(lockedUnknownNow.data, lockedEmail.data);

    const ipPortal = env();
    await updatePasswordHash(ipPortal.DB!, 1, passwordHash);
    const ip = "203.0.113.40";
    for (let i = 0; i < IP_ATTEMPT_LIMIT; i++) {
      await insertLoginAttempt(ipPortal.DB!, `attempt${i}@example.com`, ip, new Date().toISOString());
    }
    const lockedIp = await login(ipPortal, PANAMERICA, password, "http://127.0.0.1", {
      "cf-connecting-ip": ip,
      "x-forwarded-for": "198.51.100.99",
    });
    assert.equal(lockedIp.status, 429);
    assert.deepEqual(lockedIp.data, { error: "rate_limited" });

    const stale = new Date(Date.now() - ATTEMPT_WINDOW_MS - 60_000).toISOString();
    const fresh = env();
    await updatePasswordHash(fresh.DB!, 1, passwordHash);
    for (let i = 0; i < EMAIL_ATTEMPT_LIMIT; i++) {
      await insertLoginAttempt(fresh.DB!, PANAMERICA, "203.0.113.50", stale);
    }
    const allowed = await login(fresh, PANAMERICA, password, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.50",
    });
    assert.equal(allowed.status, 200);
  });

  test("pages.dev rejects login and ignores an existing session", async () => {
    const portal = env({ PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: DEALER });
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const pagesLogin = await login(portal, PANAMERICA, password, "https://preview.pages.dev");
    assert.equal(pagesLogin.status, 403);
    assert.equal(pagesLogin.data?.reason, "host_not_allowed");
    assert.equal(pagesLogin.setCookie.length, 0);

    const local = await login(portal, PANAMERICA, password);
    const cookie = sessionPair(local.setCookie);
    const pagesSession = await send(portal, "GET", "/api/portal/session", {
      host: "https://panamerica.pages.dev",
      cookie,
      origin: null,
    });
    assert.equal(pagesSession.status, 401);

    const www = await send(portal, "GET", "/api/portal/session", {
      host: "https://www.panamericafleet.com",
      cookie,
      origin: null,
    });
    assert.equal(www.status, 200);
    assert.equal(www.data?.email, PANAMERICA);
  });

  test("a real session stays inside the owner and admin gates", async () => {
    const portal = env({ PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA });
    const created = await send(portal, "POST", "/api/portal/admin/owners", {
      body: { name: "Dealer Partner", email: DEALER },
      origin: null,
    });
    assert.equal(created.status, 201);
    const dealerId = (created.data?.owner as { id: number }).id;
    const panamericaCar = await send(portal, "POST", "/api/portal/admin/cars", {
      body: {
        ownerId: 1,
        year: 2024,
        make: "Testmake",
        model: "Testmodel",
        color: "White",
        licensePlate: "TST-1001",
        vin: VIN_A,
      },
      origin: null,
    });
    assert.equal(panamericaCar.status, 201);
    const panamericaId = (panamericaCar.data?.car as { id: number }).id;
    assert.equal(
      (
        await send(portal, "POST", "/api/portal/admin/cars", {
          body: {
            ownerId: dealerId,
            year: 2024,
            make: "Testmake",
            model: "Testmodel",
            color: "Blue",
            licensePlate: "TST-1002",
            vin: VIN_B,
          },
          origin: null,
        })
      ).status,
      201
    );
    const dealer = await getOwnerByEmail(portal.DB!, DEALER);
    assert.ok(dealer);
    await updatePasswordHash(portal.DB!, dealer.id, passwordHash);
    await updatePasswordHash(portal.DB!, 1, passwordHash);

    const signedOut = { DB: portal.DB };
    const dealerLogin = await login(signedOut, DEALER, password);
    const dealerCookie = sessionPair(dealerLogin.setCookie);
    const list = await send(signedOut, "GET", `/api/portal/cars?owner_id=${panamericaId}`, {
      cookie: dealerCookie,
      origin: null,
    });
    assert.deepEqual((list.data?.cars as { vin: string }[]).map((car) => car.vin), [VIN_B]);
    const stolen = await send(signedOut, "GET", `/api/portal/cars/${panamericaId}`, {
      cookie: dealerCookie,
      origin: null,
    });
    assert.equal(stolen.status, 404);
    assert.equal(stolen.text.includes(VIN_A), false);
    const admin = await send(signedOut, "GET", "/api/portal/admin/owners", {
      cookie: dealerCookie,
      origin: null,
    });
    assert.equal(admin.status, 403);
    assert.equal(admin.data?.reason, "not_admin");

    const adminLogin = await login(signedOut, PANAMERICA, password);
    const adminCookie = sessionPair(adminLogin.setCookie);
    const owners = await send(signedOut, "GET", "/api/portal/admin/owners", {
      cookie: adminCookie,
      origin: null,
    });
    assert.equal(owners.status, 200);

    const missingCsrf = await send(signedOut, "POST", "/api/portal/admin/owners", {
      cookie: adminCookie,
      body: { name: "Nope", email: "nope@example.com" },
      headers: { "x-csrf-token": "wrong" },
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.data?.reason, "csrf");

    const createdWithCsrf = await send(signedOut, "POST", "/api/portal/admin/owners", {
      cookie: adminCookie,
      body: { name: "Second Owner", email: "second.owner@example.com" },
      headers: { "x-csrf-token": String(adminLogin.data?.csrfToken) },
    });
    assert.equal(createdWithCsrf.status, 201);
  });

  test("setup token is inert until configured, then sets a hash without returning it", async () => {
    const portal = env();
    const secret = randomBytes(24).toString("base64url");
    const unset = await send(portal, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, password },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(unset.status, 404);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const configured: PortalEnv = { ...portal, PORTAL_SETUP_TOKEN: secret };
    const wrong = await send(configured, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, password },
      headers: { "x-portal-setup-token": `${secret}no` },
    });
    assert.equal(wrong.status, 401);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const pages = await send(configured, "POST", "/api/portal/setup-password", {
      host: "https://preview.pages.dev",
      body: { email: PANAMERICA, password },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(pages.status, 403);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const token = randomToken();
    await insertSession(
      portal.DB!,
      await sha256Hex(token),
      1,
      randomToken(),
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString()
    );
    const set = await send(configured, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, password },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(set.status, 200);
    assert.deepEqual(set.data, { ok: true });
    assert.equal(set.text.includes(password), false);
    const stored = await getPasswordHash(portal.DB!, 1);
    assert.match(stored ?? "", /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(
      (await send(portal, "GET", "/api/portal/session", { cookie: `${SESSION_COOKIE}=${token}`, origin: null })).status,
      401
    );
    const signed = await login(portal, PANAMERICA, password);
    assert.equal(signed.status, 200);
  });

  test("a weak Argon2 hash is not accepted", async () => {
    const portal = env();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const weak = argon2id(password, salt, { t: 1, m: 8, p: 1, dkLen: 32 });
    const stored = `$argon2id$v=19$m=8,t=1,p=1$${base64UrlEncode(salt)}$${base64UrlEncode(weak)}`;
    await updatePasswordHash(portal.DB!, 1, stored);
    const result = await login(portal, PANAMERICA, password);
    assert.equal(result.status, 401);
    assert.deepEqual(result.data, { error: "invalid_credentials" });
  });

  test("only portal paths redirect from the apex to www", async () => {
    for (const path of ["/owner/", "/admin/", "/api/portal/login"]) {
      const response = await handlePortal(new Request(`https://panamericafleet.com${path}`), env());
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), `https://www.panamericafleet.com${path}`);
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    const fleet = await apexMiddleware({
      request: new Request("https://panamericafleet.com/fleet/"),
      next: async () => new Response("fleet"),
    });
    assert.equal(fleet.status, 200);
    assert.equal(await fleet.text(), "fleet");

    for (const path of ["/", "/plans/", "/about/", "/owners", "/api/health"]) {
      let called = false;
      const response = await apexMiddleware({
        request: new Request(`https://panamericafleet.com${path}`),
        next: async () => {
          called = true;
          return new Response("public");
        },
      });
      assert.equal(called, true, path);
      assert.equal(response.status, 200);
    }

    const owner = await apexMiddleware({
      request: new Request("https://panamericafleet.com/owner/?next=1"),
      next: async () => new Response("shell"),
    });
    assert.equal(owner.status, 308);
    assert.equal(owner.headers.get("location"), "https://www.panamericafleet.com/owner/?next=1");

    const www = await apexMiddleware({
      request: new Request("https://www.panamericafleet.com/fleet/"),
      next: async () => new Response("fleet"),
    });
    assert.equal(www.status, 200);
  });

  test("login without a same-origin Origin is rejected", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const missing = await login(portal, PANAMERICA, password, "http://127.0.0.1");
    const crossSite = await send(portal, "POST", "/api/portal/login", {
      body: { email: PANAMERICA, password },
      origin: "https://evil.example",
    });
    assert.equal(missing.status, 200);
    const noOrigin = await send(portal, "POST", "/api/portal/login", {
      body: { email: PANAMERICA, password },
      origin: null,
    });
    assert.equal(noOrigin.status, 403);
    assert.equal(noOrigin.data?.reason, "csrf");
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.data?.reason, "csrf");
  });
});
