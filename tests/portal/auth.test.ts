import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { onRequest as apexMiddleware } from "../../functions/_middleware";
import { randomToken, sha256Hex } from "../../lib/portal/codec";
import { countLoginFailuresForEmail, countLoginFailuresForPair } from "../../lib/portal/db";
import {
  getOwnerByEmail,
  getPasswordHash,
  insertLoginAttempt,
  insertSession,
  updatePasswordHash,
} from "../../lib/portal/db";
import { derivePortalKey, encodeDerived, PASSWORD_MIN_LENGTH, portalSalt, PORTAL_SALT_PREFIX } from "../../lib/portal/derive";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { rateLimitIp } from "../../lib/portal/hosts";
import {
  ATTEMPT_WINDOW_MS,
  EMAIL_FAILURE_LIMIT,
  PAIR_FAILURE_LIMIT,
  PREFIX48_FAILURE_LIMIT,
} from "../../lib/portal/login";
import { decodeDerived, macDerived, sealDerived, SERVER_AUTH_BUDGET_MS } from "../../lib/portal/mac";
import { DEVICE_COOKIE, SESSION_COOKIE } from "../../lib/portal/session";
import { createMemoryD1 } from "./memory-d1";

const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";
const VIN_A = "1TSTCAR0000000001";
const VIN_B = "2TSTCAR0000000002";

let pepper = "";
let password = "";
let derivedPanamerica = "";
let derivedDealer = "";
let wrongDerived = "";
let passwordHash = "";
let dealerHash = "";

before(async () => {
  pepper = randomBytes(32).toString("base64url");
  password = randomBytes(18).toString("base64url");
  assert.ok(password.length >= PASSWORD_MIN_LENGTH);
  const panBytes = await derivePortalKey(PANAMERICA, password);
  const dealerBytes = await derivePortalKey(DEALER, password);
  const wrongBytes = await derivePortalKey(PANAMERICA, `${password}no`);
  derivedPanamerica = encodeDerived(panBytes);
  derivedDealer = encodeDerived(dealerBytes);
  wrongDerived = encodeDerived(wrongBytes);
  passwordHash = await sealDerived(pepper, panBytes);
  dealerHash = await sealDerived(pepper, dealerBytes);
  assert.match(passwordHash, /^hmac-sha256\$/);
  assert.notEqual(derivedPanamerica, derivedDealer);
  assert.equal(passwordHash.includes(password), false);
  const salt = await portalSalt(PANAMERICA);
  const expectedSalt = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${PORTAL_SALT_PREFIX}\0${PANAMERICA}`))
  );
  assert.deepEqual(salt, expectedSalt);
});

function env(extra: Partial<PortalEnv> = {}): PortalEnv {
  return { DB: createMemoryD1(), PORTAL_PEPPER: pepper, ...extra };
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
  derived: string,
  host = "http://127.0.0.1",
  headers?: Record<string, string>
) {
  return send(portal, "POST", "/api/portal/login", {
    body: { email, derived },
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
    const signed = await login(portal, PANAMERICA, derivedPanamerica);
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

    const again = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
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
    const bad = await login(portal, PANAMERICA, wrongDerived);
    const unknown = await login(portal, "nobody@example.com", derivedPanamerica);
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(bad.data, { error: "invalid_credentials" });
    assert.deepEqual(unknown.data, bad.data);
    assert.equal(bad.setCookie.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.includes("Max-Age=0")), false);
    assert.equal(unknown.setCookie.length, 0);
    assert.equal(bad.text.includes(PANAMERICA), false);
    assert.equal(unknown.text.includes("nobody@example.com"), false);
  });

  test("failed logins are limited per email and IP, with a high email-only cap", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const successes = await login(portal, PANAMERICA, derivedPanamerica);
    assert.equal(successes.status, 200);
    assert.equal(await countLoginFailuresForEmail(portal.DB!, PANAMERICA, "1970-01-01T00:00:00.000Z"), 0);

    const pairIp = "203.0.113.10";
    for (let i = 0; i < PAIR_FAILURE_LIMIT; i++) {
      await insertLoginAttempt(portal.DB!, PANAMERICA, pairIp, new Date().toISOString());
    }
    const lockedPair = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": pairIp,
      "x-forwarded-for": "198.51.100.20",
    });
    assert.equal(lockedPair.status, 429);
    assert.deepEqual(lockedPair.data, { error: "rate_limited" });
    assert.equal(
      await countLoginFailuresForPair(portal.DB!, PANAMERICA, pairIp, "1970-01-01T00:00:00.000Z"),
      PAIR_FAILURE_LIMIT
    );

    const otherIp = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.11",
    });
    assert.equal(otherIp.status, 200);

    const emailPortal = env();
    await updatePasswordHash(emailPortal.DB!, 1, passwordHash);
    for (let i = 0; i < EMAIL_FAILURE_LIMIT; i++) {
      await insertLoginAttempt(emailPortal.DB!, PANAMERICA, `203.0.113.${i % 200}`, new Date().toISOString());
    }
    const cleanDuringFlood = await login(emailPortal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": "192.0.2.55",
    });
    assert.equal(cleanDuringFlood.status, 200);
    const noisyIp = "198.51.100.7";
    for (let i = 0; i < 3; i++) {
      await insertLoginAttempt(emailPortal.DB!, PANAMERICA, noisyIp, new Date().toISOString());
    }
    const lockedEmail = await login(emailPortal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": noisyIp,
    });
    assert.equal(lockedEmail.status, 429);
    assert.deepEqual(lockedEmail.data, lockedPair.data);

    const stale = new Date(Date.now() - ATTEMPT_WINDOW_MS - 60_000).toISOString();
    const fresh = env();
    await updatePasswordHash(fresh.DB!, 1, passwordHash);
    for (let i = 0; i < PAIR_FAILURE_LIMIT; i++) {
      await insertLoginAttempt(fresh.DB!, PANAMERICA, "203.0.113.50", stale);
    }
    const allowed = await login(fresh, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.50",
    });
    assert.equal(allowed.status, 200);
  });

  test("one network cannot lock a clean network out of the public owner email", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const attacker = "203.0.113.8";
    let unauthorized = 0;
    let limited = 0;
    for (let i = 0; i < 300; i++) {
      const result = await login(portal, PANAMERICA, wrongDerived, "http://127.0.0.1", {
        "cf-connecting-ip": attacker,
      });
      if (result.status === 401) unauthorized += 1;
      else if (result.status === 429) limited += 1;
    }
    assert.equal(unauthorized, PAIR_FAILURE_LIMIT);
    assert.equal(limited, 300 - PAIR_FAILURE_LIMIT);
    assert.equal(
      await countLoginFailuresForEmail(portal.DB!, PANAMERICA, "1970-01-01T00:00:00.000Z"),
      PAIR_FAILURE_LIMIT
    );
    const clean = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": "203.0.113.9",
    });
    assert.equal(clean.status, 200);
  });

  test("many /64s in one /48 cannot exceed the /48 cap", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    for (let i = 0; i < PREFIX48_FAILURE_LIMIT; i++) {
      const result = await login(portal, PANAMERICA, wrongDerived, "http://127.0.0.1", {
        "cf-connecting-ip": `2001:db8:10:${i.toString(16)}::1`,
      });
      assert.equal(result.status, 401);
    }
    const blocked = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": `2001:db8:10:${PREFIX48_FAILURE_LIMIT.toString(16)}::1`,
    });
    assert.equal(blocked.status, 429);
    assert.equal(
      await countLoginFailuresForEmail(portal.DB!, PANAMERICA, "1970-01-01T00:00:00.000Z"),
      PREFIX48_FAILURE_LIMIT
    );
    const other = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": "2001:db8:11::1",
    });
    assert.equal(other.status, 200);
  });

  test("IPv6 failures share a /64 and a trusted device skips the email-wide cap", async () => {
    const portal = env();
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const inside = "2001:db8:1:2::10";
    const sibling = "2001:db8:1:2::abcd";
    const elsewhere = "2001:db8:9:9::1";
    assert.equal(rateLimitIp(inside), rateLimitIp(sibling));
    assert.notEqual(rateLimitIp(inside), rateLimitIp(elsewhere));
    assert.equal(rateLimitIp("203.0.113.10"), "203.0.113.10");
    for (let i = 0; i < PAIR_FAILURE_LIMIT; i++) {
      await insertLoginAttempt(portal.DB!, PANAMERICA, rateLimitIp(inside), new Date().toISOString());
    }
    const sameNet = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": sibling,
    });
    assert.equal(sameNet.status, 429);
    const otherNet = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": elsewhere,
    });
    assert.equal(otherNet.status, 200);
    const device = otherNet.setCookie.find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`));
    assert.ok(device);
    assert.match(device, /HttpOnly/);
    assert.match(device, /Secure/);
    assert.match(device, /SameSite=Lax/);
    assert.doesNotMatch(device, /Domain=/i);

    const home = "198.51.100.40";
    for (let i = 0; i < EMAIL_FAILURE_LIMIT; i++) {
      await insertLoginAttempt(portal.DB!, PANAMERICA, `198.51.100.${(i % 50) + 1}`, new Date().toISOString());
    }
    for (let i = 0; i < 3; i++) {
      await insertLoginAttempt(portal.DB!, PANAMERICA, home, new Date().toISOString());
    }
    const blocked = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      "cf-connecting-ip": home,
    });
    assert.equal(blocked.status, 429);
    const trusted = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1", {
      cookie: device.split(";")[0],
      "cf-connecting-ip": home,
    });
    assert.equal(trusted.status, 200);
  });

  test("login and setup fail closed without a long pepper", async () => {
    const short = randomBytes(16).toString("hex").slice(0, 31);
    const usable = randomBytes(24).toString("base64url");
    assert.equal(short.length, 31);
    assert.ok(usable.length >= 32);
    for (const value of [undefined, "", short] as const) {
      const portal = env({ PORTAL_PEPPER: value, PORTAL_SETUP_TOKEN: randomBytes(24).toString("base64url") });
      const signed = await login(portal, PANAMERICA, derivedPanamerica);
      assert.equal(signed.status, 500);
      assert.deepEqual(signed.data, { error: "auth_unconfigured" });
      const setup = await send(portal, "POST", "/api/portal/setup-password", {
        body: { email: PANAMERICA, derived: derivedPanamerica },
        headers: { "x-portal-setup-token": portal.PORTAL_SETUP_TOKEN ?? "" },
      });
      assert.equal(setup.status, 500);
      assert.deepEqual(setup.data, { error: "auth_unconfigured" });
    }
    const bytes = decodeDerived(derivedPanamerica);
    assert.ok(bytes);
    const portal = env({ PORTAL_PEPPER: usable });
    await updatePasswordHash(portal.DB!, 1, await sealDerived(usable, bytes));
    assert.equal((await login(portal, PANAMERICA, derivedPanamerica)).status, 200);
  });

  test("the setup script reads a piped password and prints the derived key", async () => {
    const secret = randomBytes(18).toString("base64url");
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/portal-setup-body.mts", PANAMERICA], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        err += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(err || `exit ${code}`));
      });
      child.stdin.end(secret);
    });
    const body = JSON.parse(stdout) as { email?: string; derived?: string; password?: string };
    assert.equal(body.email, PANAMERICA);
    assert.equal(body.password, undefined);
    assert.equal(stdout.includes(secret), false);
    const decoded = decodeDerived(body.derived);
    assert.equal(decoded?.length, 32);
    assert.equal(body.derived, encodeDerived(await derivePortalKey(PANAMERICA, secret)));
  });

  test("pages.dev rejects login and ignores an existing session", async () => {
    const portal = env({ PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: DEALER });
    await updatePasswordHash(portal.DB!, 1, passwordHash);
    const pagesLogin = await login(portal, PANAMERICA, derivedPanamerica, "https://preview.pages.dev");
    assert.equal(pagesLogin.status, 403);
    assert.equal(pagesLogin.data?.reason, "host_not_allowed");
    assert.equal(pagesLogin.setCookie.length, 0);

    const local = await login(portal, PANAMERICA, derivedPanamerica);
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
    await updatePasswordHash(portal.DB!, dealer.id, dealerHash);
    await updatePasswordHash(portal.DB!, 1, passwordHash);

    const signedOut = { DB: portal.DB, PORTAL_PEPPER: pepper };
    const dealerLogin = await login(signedOut, DEALER, derivedDealer);
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

    const adminLogin = await login(signedOut, PANAMERICA, derivedPanamerica);
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
    const rawPassword = await send(portal, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, password, derived: derivedPanamerica },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(rawPassword.status, 404);

    const unset = await send(portal, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(unset.status, 404);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const configured: PortalEnv = { ...portal, PORTAL_SETUP_TOKEN: secret };
    const wrong = await send(configured, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
      headers: { "x-portal-setup-token": `${secret}no` },
    });
    assert.equal(wrong.status, 401);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const pages = await send(configured, "POST", "/api/portal/setup-password", {
      host: "https://preview.pages.dev",
      body: { email: PANAMERICA, derived: derivedPanamerica },
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
    const rejected = await send(configured, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, password, derived: derivedPanamerica },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(rejected.status, 400);
    assert.equal(await getPasswordHash(portal.DB!, 1), null);

    const set = await send(configured, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
      headers: { "x-portal-setup-token": secret },
    });
    assert.equal(set.status, 200);
    assert.deepEqual(set.data, { ok: true });
    assert.equal(set.text.includes(password), false);
    assert.equal(set.text.includes(derivedPanamerica), false);
    const stored = await getPasswordHash(portal.DB!, 1);
    assert.equal(stored, passwordHash);
    assert.equal(
      (await send(portal, "GET", "/api/portal/session", { cookie: `${SESSION_COOKIE}=${token}`, origin: null })).status,
      401
    );
    const signed = await login(portal, PANAMERICA, derivedPanamerica);
    assert.equal(signed.status, 200);
  });

  test("the server rejects a stored Argon2 string and stays inside the CPU budget", async () => {
    const portal = env();
    await updatePasswordHash(
      portal.DB!,
      1,
      "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaA"
    );
    const started = performance.now();
    const result = await login(portal, PANAMERICA, derivedPanamerica);
    const elapsed = performance.now() - started;
    assert.equal(result.status, 401);
    assert.deepEqual(result.data, { error: "invalid_credentials" });
    assert.ok(elapsed < SERVER_AUTH_BUDGET_MS, `server auth took ${elapsed}ms`);

    const macStarted = performance.now();
    await macDerived(pepper, new Uint8Array(32));
    const macElapsed = performance.now() - macStarted;
    assert.ok(macElapsed < SERVER_AUTH_BUDGET_MS, `hmac took ${macElapsed}ms`);

    const roots = ["functions/_middleware.ts", "functions/api/portal/[[path]].ts"];
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /argon2|bcrypt|pbkdf2|hash-wasm|@noble\/hashes/i);
      const dir = dirname(file);
      for (const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target = join(dir, match[1].endsWith(".ts") ? match[1] : `${match[1]}.ts`);
        visit(target);
      }
    };
    for (const root of roots) visit(root);
    assert.equal([...seen].some((file) => file.endsWith("derive.ts")), false);
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
    const missing = await login(portal, PANAMERICA, derivedPanamerica, "http://127.0.0.1");
    const crossSite = await send(portal, "POST", "/api/portal/login", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
      origin: "https://evil.example",
    });
    assert.equal(missing.status, 200);
    const noOrigin = await send(portal, "POST", "/api/portal/login", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
      origin: null,
    });
    assert.equal(noOrigin.status, 403);
    assert.equal(noOrigin.data?.reason, "csrf");
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.data?.reason, "csrf");
  });
});
