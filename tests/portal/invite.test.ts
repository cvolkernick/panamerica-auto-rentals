import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, describe, test } from "node:test";

import { randomToken, sha256Hex } from "../../lib/portal/codec";
import {
  countLoginFailuresForPair,
  getOwnerInviteByHash,
  getPasswordHash,
  insertSession,
  updatePasswordHash,
} from "../../lib/portal/db";
import { derivePortalKey, encodeDerived, PASSWORD_MIN_LENGTH } from "../../lib/portal/derive";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { INVITE_ATTEMPT_EMAIL, INVITE_TTL_MS, maskEmail } from "../../lib/portal/invite";
import { PAIR_FAILURE_LIMIT, PREFIX48_FAILURE_LIMIT } from "../../lib/portal/login";
import { sealDerived } from "../../lib/portal/mac";
import { SESSION_COOKIE } from "../../lib/portal/session";
import { createMemoryD1, loadMigrationSql } from "./memory-d1";

const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";

let pepper = "";
let derivedPanamerica = "";
let derivedDealer = "";
let passwordHash = "";
let dealerHash = "";

before(async () => {
  pepper = randomBytes(32).toString("base64url");
  const password = randomBytes(18).toString("base64url");
  assert.ok(password.length >= PASSWORD_MIN_LENGTH);
  const panBytes = await derivePortalKey(PANAMERICA, password);
  const dealerBytes = await derivePortalKey(DEALER, password);
  derivedPanamerica = encodeDerived(panBytes);
  derivedDealer = encodeDerived(dealerBytes);
  passwordHash = await sealDerived(pepper, panBytes);
  dealerHash = await sealDerived(pepper, dealerBytes);
});

function devEnv(db = createMemoryD1()): PortalEnv {
  return {
    DB: db,
    PORTAL_PEPPER: pepper,
    PORTAL_DEV_AUTH: "1",
    PORTAL_DEV_EMAIL: PANAMERICA,
  };
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
    setCookie: response.headers.getSetCookie(),
  };
}

function tokenFrom(url: unknown): string {
  assert.equal(typeof url, "string");
  const parsed = new URL(String(url));
  const token = parsed.searchParams.get("t");
  assert.ok(token);
  assert.equal(String(url), `https://www.panamericafleet.com/owner/invite/?t=${token}`);
  return token;
}

async function mint(portal: PortalEnv, ownerId = 1, cookie?: string, csrf?: string) {
  return send(portal, "POST", `/api/portal/admin/owners/${ownerId}/invite`, {
    cookie,
    headers: csrf ? { "x-csrf-token": csrf } : undefined,
    origin: cookie ? undefined : null,
  });
}

function sessionPair(setCookie: string[]): string {
  const raw = setCookie.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(raw);
  return raw.split(";")[0];
}

async function login(portal: PortalEnv, email: string, derived: string) {
  return send(portal, "POST", "/api/portal/login", { body: { email, derived } });
}

describe("owner invite links", () => {
  test("migration stores a hash and does not insert a token", () => {
    const sql = loadMigrationSql("0003_owner_invites.sql");
    assert.match(sql, /CREATE TABLE owner_invites/);
    assert.match(sql, /token_hash TEXT PRIMARY KEY/);
    assert.match(sql, /owner_id INTEGER NOT NULL/);
    assert.match(sql, /created_at TEXT NOT NULL/);
    assert.match(sql, /expires_at TEXT NOT NULL/);
    assert.match(sql, /used_at TEXT/);
    assert.doesNotMatch(sql, /INSERT\s+INTO/i);
    assert.equal(maskEmail(PANAMERICA), "p***@gmail.com");
  });

  test("mint stores only the hash and shows the link once", async () => {
    const portal = devEnv();
    const created = await mint(portal);
    assert.equal(created.status, 201);
    const token = tokenFrom(created.data?.url);
    assert.equal(created.text.includes(passwordHash), false);
    const row = await getOwnerInviteByHash(portal.DB!, await sha256Hex(token));
    assert.ok(row);
    assert.equal(row.token_hash, await sha256Hex(token));
    assert.notEqual(row.token_hash, token);
    assert.equal(row.owner_id, 1);
    assert.equal(row.used_at, null);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), INVITE_TTL_MS);
    for (const value of Object.values(row)) {
      assert.notEqual(value, token);
    }

    const listed = await send(portal, "GET", "/api/portal/admin/owners", { origin: null });
    assert.equal(listed.text.includes(token), false);

    const preview = await send(portal, "GET", `/api/portal/invite?t=${token}`, { origin: null });
    assert.equal(preview.status, 200);
    assert.equal(preview.data?.email, PANAMERICA);
    assert.equal(preview.data?.emailMasked, "p***@gmail.com");
    assert.equal(preview.text.includes(token), false);
    assert.equal(preview.text.includes("password_hash"), false);
    assert.deepEqual(Object.keys(preview.data ?? {}).sort(), ["email", "emailMasked"]);
  });

  test("redeem seals the derived key, marks the token used, and deletes sessions", async () => {
    const db = createMemoryD1();
    const portal = devEnv(db);
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const created = await mint(portal);
    const token = tokenFrom(created.data?.url);
    const sessionToken = randomToken();
    await insertSession(
      db,
      await sha256Hex(sessionToken),
      1,
      randomToken(),
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString()
    );

    const raw = await send(real, "POST", "/api/portal/invite", {
      body: { token, password: "not-the-derived-key", derived: derivedPanamerica },
    });
    assert.equal(raw.status, 400);
    assert.equal((raw.data?.fields as { derived?: string } | undefined)?.derived, "Send the derived key.");
    assert.equal(raw.text.includes("not-the-derived-key"), false);
    assert.equal((await getOwnerInviteByHash(db, await sha256Hex(token)))?.used_at, null);

    const redeemed = await send(real, "POST", "/api/portal/invite", {
      body: { token, derived: derivedPanamerica },
    });
    assert.equal(redeemed.status, 200);
    assert.deepEqual(redeemed.data, { ok: true });
    assert.equal(redeemed.setCookie.length, 0);
    assert.equal(redeemed.text.includes(token), false);
    assert.equal(redeemed.text.includes(derivedPanamerica), false);
    assert.equal(await getPasswordHash(db, 1), passwordHash);
    const used = await getOwnerInviteByHash(db, await sha256Hex(token));
    assert.ok(used?.used_at);
    const sessions = await db.prepare(`SELECT COUNT(*) AS n FROM sessions`).bind().first<{ n: number }>();
    assert.equal(Number(sessions?.n), 0);
    assert.equal(
      (await send(real, "GET", "/api/portal/session", { cookie: `${SESSION_COOKIE}=${sessionToken}`, origin: null }))
        .status,
      401
    );

    const again = await send(real, "POST", "/api/portal/invite", {
      body: { token, derived: derivedPanamerica },
    });
    assert.equal(again.status, 400);
    assert.equal(again.data?.error, "invite_invalid");
    const signed = await login(real, PANAMERICA, derivedPanamerica);
    assert.equal(signed.status, 200);

    const setup = await send(real, "POST", "/api/portal/setup-password", {
      body: { email: PANAMERICA, derived: derivedPanamerica },
    });
    assert.equal(setup.status, 404);
  });

  test("an expired invite is rejected and a new link invalidates only that owner's unused links", async () => {
    const db = createMemoryD1();
    const portal = devEnv(db);
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const dealer = await send(portal, "POST", "/api/portal/admin/owners", {
      body: { name: "Dealer Partner", email: DEALER },
      origin: null,
    });
    assert.equal(dealer.status, 201);
    const dealerId = (dealer.data?.owner as { id: number }).id;

    const first = await mint(portal);
    const firstToken = tokenFrom(first.data?.url);
    await db
      .prepare(`UPDATE owner_invites SET expires_at = ? WHERE token_hash = ?`)
      .bind("2000-01-01T00:00:00.000Z", await sha256Hex(firstToken))
      .run();
    const expiredGet = await send(real, "GET", `/api/portal/invite?t=${firstToken}`, { origin: null });
    assert.equal(expiredGet.status, 400);
    assert.equal(expiredGet.data?.error, "invite_invalid");
    assert.equal(expiredGet.text.includes(PANAMERICA), false);
    const expiredPost = await send(real, "POST", "/api/portal/invite", {
      body: { token: firstToken, derived: derivedPanamerica },
    });
    assert.equal(expiredPost.status, 400);
    assert.equal(await getPasswordHash(db, 1), null);

    const kept = await mint(portal);
    const keptToken = tokenFrom(kept.data?.url);
    const dealerLink = await mint(portal, dealerId);
    const dealerToken = tokenFrom(dealerLink.data?.url);
    const replaced = await mint(portal);
    const replacedToken = tokenFrom(replaced.data?.url);

    const oldKept = await getOwnerInviteByHash(db, await sha256Hex(keptToken));
    assert.ok(oldKept?.used_at);
    const replacedRow = await getOwnerInviteByHash(db, await sha256Hex(replacedToken));
    assert.equal(replacedRow?.used_at, null);
    const dealerRow = await getOwnerInviteByHash(db, await sha256Hex(dealerToken));
    assert.equal(dealerRow?.used_at, null);

    const stale = await send(real, "POST", "/api/portal/invite", {
      body: { token: keptToken, derived: derivedPanamerica },
    });
    assert.equal(stale.status, 400);
    assert.equal(await getPasswordHash(db, 1), null);

    const dealerRedeem = await send(real, "POST", "/api/portal/invite", {
      body: { token: dealerToken, derived: derivedDealer },
    });
    assert.equal(dealerRedeem.status, 200);
    const dealerLogin = await login(real, DEALER, derivedDealer);
    assert.equal(dealerLogin.status, 200);

    const current = await send(real, "POST", "/api/portal/invite", {
      body: { token: replacedToken, derived: derivedPanamerica },
    });
    assert.equal(current.status, 200);
    assert.equal(await getPasswordHash(db, 1), passwordHash);
  });

  test("unknown tokens fail the same way and redemption failures are rate limited", async () => {
    const db = createMemoryD1();
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const bogus = randomToken(32);
    const missing = await send(real, "GET", `/api/portal/invite?t=${bogus}`, { origin: null });
    assert.equal(missing.status, 400);
    assert.equal(missing.data?.error, "invite_invalid");
    assert.equal(missing.text.includes(PANAMERICA), false);
    const posted = await send(real, "POST", "/api/portal/invite", {
      body: { token: "not-a-token", derived: derivedPanamerica },
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    assert.equal(posted.status, 400);

    for (let i = 0; i < PAIR_FAILURE_LIMIT - 1; i++) {
      const attempt = await send(real, "POST", "/api/portal/invite", {
        body: { token: randomToken(32), derived: derivedPanamerica },
        headers: { "cf-connecting-ip": "203.0.113.10" },
      });
      assert.equal(attempt.status, 400);
    }
    const limited = await send(real, "POST", "/api/portal/invite", {
      body: { token: randomToken(32), derived: derivedPanamerica },
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    assert.equal(limited.status, 429);
    assert.equal(
      await countLoginFailuresForPair(db, INVITE_ATTEMPT_EMAIL, "203.0.113.10", "1970-01-01T00:00:00.000Z"),
      PAIR_FAILURE_LIMIT
    );
    const otherIp = await send(real, "POST", "/api/portal/invite", {
      body: { token: randomToken(32), derived: derivedPanamerica },
      headers: { "cf-connecting-ip": "203.0.113.11" },
    });
    assert.equal(otherIp.status, 400);

    for (let i = 0; i < PREFIX48_FAILURE_LIMIT; i++) {
      const attempt = await send(real, "POST", "/api/portal/invite", {
        body: { token: randomToken(32), derived: derivedPanamerica },
        headers: { "cf-connecting-ip": `2001:db8:10:${i.toString(16)}::1` },
      });
      assert.equal(attempt.status, 400);
    }
    const blocked = await send(real, "POST", "/api/portal/invite", {
      body: { token: randomToken(32), derived: derivedPanamerica },
      headers: { "cf-connecting-ip": "2001:db8:10:ffff::1" },
    });
    assert.equal(blocked.status, 429);
    const otherNet = await send(real, "POST", "/api/portal/invite", {
      body: { token: randomToken(32), derived: derivedPanamerica },
      headers: { "cf-connecting-ip": "2001:db8:11::1" },
    });
    assert.equal(otherNet.status, 400);
  });

  test("guests and non-admins cannot mint, and a real admin needs the CSRF token", async () => {
    const db = createMemoryD1();
    const portal = devEnv(db);
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const open = await send(real, "POST", "/api/portal/admin/owners/1/invite");
    assert.equal(open.status, 401);

    const dealer = await send(portal, "POST", "/api/portal/admin/owners", {
      body: { name: "Dealer Partner", email: DEALER },
      origin: null,
    });
    const dealerId = (dealer.data?.owner as { id: number }).id;
    await updatePasswordHash(db, dealerId, dealerHash);
    await updatePasswordHash(db, 1, passwordHash);
    const dealerLogin = await login(real, DEALER, derivedDealer);
    const dealerCookie = sessionPair(dealerLogin.setCookie);
    const forbidden = await send(real, "POST", "/api/portal/admin/owners/1/invite", {
      cookie: dealerCookie,
      headers: { "x-csrf-token": String(dealerLogin.data?.csrfToken) },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.data?.reason, "not_admin");
    const none = await db.prepare(`SELECT COUNT(*) AS n FROM owner_invites`).bind().first<{ n: number }>();
    assert.equal(Number(none?.n), 0);

    const adminLogin = await login(real, PANAMERICA, derivedPanamerica);
    const adminCookie = sessionPair(adminLogin.setCookie);
    const missing = await send(real, "POST", "/api/portal/admin/owners/1/invite", {
      cookie: adminCookie,
    });
    assert.equal(missing.status, 403);
    assert.equal(missing.data?.reason, "csrf");
    const wrong = await send(real, "POST", "/api/portal/admin/owners/1/invite", {
      cookie: adminCookie,
      headers: { "x-csrf-token": "wrong" },
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data?.reason, "csrf");
    const stillNone = await db.prepare(`SELECT COUNT(*) AS n FROM owner_invites`).bind().first<{ n: number }>();
    assert.equal(Number(stillNone?.n), 0);

    const created = await mint(real, 1, adminCookie, String(adminLogin.data?.csrfToken));
    assert.equal(created.status, 201);
    const token = tokenFrom(created.data?.url);
    assert.equal((await getOwnerInviteByHash(db, await sha256Hex(token)))?.owner_id, 1);

    const method = await send(real, "GET", "/api/portal/admin/owners/1/invite", {
      cookie: adminCookie,
      origin: null,
    });
    assert.equal(method.status, 405);
  });

  test("a missing pepper or a disallowed host does not burn the invite", async () => {
    const db = createMemoryD1();
    const portal = devEnv(db);
    const created = await mint(portal);
    const token = tokenFrom(created.data?.url);
    const noPepper = await send({ DB: db }, "POST", "/api/portal/invite", {
      body: { token, derived: derivedPanamerica },
    });
    assert.equal(noPepper.status, 500);
    assert.equal(noPepper.data?.error, "auth_unconfigured");
    assert.equal((await getOwnerInviteByHash(db, await sha256Hex(token)))?.used_at, null);

    const pages = await send({ DB: db, PORTAL_PEPPER: pepper }, "POST", "/api/portal/invite", {
      host: "https://preview.pages.dev",
      body: { token, derived: derivedPanamerica },
    });
    assert.equal(pages.status, 403);
    assert.equal(pages.data?.reason, "host_not_allowed");
    assert.equal((await getOwnerInviteByHash(db, await sha256Hex(token)))?.used_at, null);
  });

  test("invite code does not log and the visible controls are present", () => {
    for (const path of ["lib/portal/invite.ts", "app/owner/invite/invite-portal.tsx", "app/admin/admin-portal.tsx"]) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /console\./);
    }
    const page = readFileSync("app/owner/invite/invite-portal.tsx", "utf8");
    assert.match(page, /derivePortalKey/);
    assert.match(page, /encodeDerived/);
    assert.match(page, /passwordAcceptable/);
    assert.match(page, /token: gate\.token, derived/);
    assert.doesNotMatch(page, /body:\s*\{[^}]*password/);
    const admin = readFileSync("app/admin/admin-portal.tsx", "utf8");
    assert.match(admin, /Create invite link/);
    assert.match(admin, /"Copy"/);
    const card = readFileSync("app/owner/owner-portal.tsx", "utf8");
    assert.match(card, /min-w-0/);
    assert.match(card, /wrap-anywhere/);
    assert.match(card, /minmax\(0,1fr\)/);
  });
});
