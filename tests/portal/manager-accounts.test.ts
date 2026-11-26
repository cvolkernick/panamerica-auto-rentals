/**
 * Manager accounts and the read-only manager view (docs/manager-role.md, phase 2).
 * Covers every authz test the spec requires, plus the positive paths.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";

import { sha256Hex } from "../../lib/portal/codec";
import { getOwnerInviteByHash, getPasswordHash } from "../../lib/portal/db";
import { derivePortalKey, encodeDerived } from "../../lib/portal/derive";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { isPortalSurface, portalApexRedirect } from "../../lib/portal/hosts";
import { sealDerived } from "../../lib/portal/mac";
import { clipWindows, inWindows, windowMonths } from "../../lib/portal/manager-view";
import { isMissingAccountColumn, parseAccountLink } from "../../lib/portal/managers";
import { SESSION_COOKIE } from "../../lib/portal/session";
import { createMemoryD1, loadMigrationSql } from "./memory-d1";
import { call, DEALER, devEnv, PANAMERICA, requireDb, startLedgerEarly } from "./support";

const MANAGER_EMAIL = "mia.manager@example.com";
const DUAL_EMAIL = "ariel.dual@example.com";
const OTHER_EMAIL = "ben.other@example.com";
const OWNER_NAME = "Dana Dealer Owner";

let pepper = "";
let password = "";

before(() => {
  pepper = randomBytes(32).toString("base64url");
  password = randomBytes(18).toString("base64url");
});

function as(env: PortalEnv, email: string): PortalEnv {
  return { ...env, PORTAL_DEV_EMAIL: email };
}

async function sql(env: PortalEnv, query: string, ...values: (string | number | null)[]) {
  return requireDb(env).prepare(query).bind(...values).run();
}

async function first<T>(env: PortalEnv, query: string, ...values: (string | number | null)[]) {
  return requireDb(env).prepare(query).bind(...values).first<T>();
}

async function addOwner(env: PortalEnv, name: string, email: string, admin = 0): Promise<number> {
  const result = await sql(env, `INSERT INTO owners (name, email, is_admin) VALUES (?, ?, ?)`, name, email, admin);
  return Number(result.meta.last_row_id);
}

async function addCar(env: PortalEnv, ownerId: number, plate: string): Promise<number> {
  const result = await sql(
    env,
    `INSERT INTO cars (owner_id, year, make, model, color, license_plate, vin) VALUES (?, 2023, 'Tesla', 'Model 3', 'Black', ?, ?)`,
    ownerId,
    plate,
    `VIN${plate}`.padEnd(17, "0").slice(0, 17)
  );
  return Number(result.meta.last_row_id);
}

async function addTrip(env: PortalEnv, carId: number, ext: string, start: string, end: string, payoutCents: number) {
  await sql(
    env,
    `INSERT INTO trips (car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income, payout_cents)
     VALUES (?, 'turo', ?, ?, ?, 'Completed', 1, ?)`,
    carId,
    ext,
    start,
    end,
    payoutCents
  );
}

async function addExpense(env: PortalEnv, carId: number, date: string, cents: number) {
  await sql(
    env,
    `INSERT INTO expenses (car_id, entry_date, category, amount_cents, note, created_by) VALUES (?, ?, 'cleaning', ?, NULL, 1)`,
    carId,
    date,
    cents
  );
}

async function addLedger(env: PortalEnv, carId: number, date: string, type: string, cents: number) {
  await sql(
    env,
    `INSERT INTO car_ledger (car_id, entry_date, type, amount_cents, note, created_by) VALUES (?, ?, ?, ?, NULL, 1)`,
    carId,
    date,
    type,
    cents
  );
}

/** Admin creates a manager through the API (new email -> new login account). */
async function createManager(env: PortalEnv, name: string, email: string, effectiveFrom = "2026-01-01") {
  const res = await call(env, "POST", "/api/portal/admin/managers", { name, email, shareBps: 2500, effectiveFrom });
  assert.equal(res.status, 201, res.text);
  return res.data?.manager as { id: number; accountId: number; accountEmail: string };
}

async function assign(env: PortalEnv, carId: number, managerId: number | null, startDate: string) {
  const res = await call(env, "POST", `/api/portal/admin/cars/${carId}/managers`, { managerId, startDate });
  assert.ok(res.status === 200 || res.status === 201, res.text);
}

function realRequest(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; csrf?: string } = {}
): Request {
  const headers = new Headers({ origin: "http://127.0.0.1" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set("x-csrf-token", options.csrf);
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function send(env: PortalEnv, method: string, path: string, options: Parameters<typeof realRequest>[2] = {}) {
  const response = await handlePortal(realRequest(method, path, options), env);
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    text,
    setCookie: response.headers.getSetCookie(),
  };
}

function tokenFrom(url: unknown, page: "owner" | "manager"): string {
  const parsed = new URL(String(url));
  const token = parsed.searchParams.get("t") ?? "";
  assert.equal(String(url), `https://www.panamericafleet.com/${page}/invite/?t=${token}`);
  return token;
}

describe("migration 0009: managers.account_id", () => {
  test("adds a nullable column and a partial unique index only; no NOT NULL, no data", () => {
    const text = loadMigrationSql("0009_manager_accounts.sql");
    assert.match(text, /ALTER TABLE managers ADD COLUMN account_id INTEGER REFERENCES owners \(id\) ON DELETE RESTRICT;/);
    assert.match(text, /CREATE UNIQUE INDEX idx_managers_account_id ON managers \(account_id\) WHERE account_id IS NOT NULL;/);
    const statements = text.replace(/--.*$/gm, "");
    assert.doesNotMatch(statements, /ADD COLUMN[^;]*NOT NULL/i);
    assert.doesNotMatch(statements, /ALTER COLUMN|SET NOT NULL/i);
    assert.doesNotMatch(statements, /^\s*(INSERT|UPDATE|DELETE|DROP)\b/im);
    assert.match(text, /pragma_table_info\('managers'\)/);
  });

  test("unlinked rows coexist, one account links to at most one manager, and a linked account cannot be deleted", async () => {
    const env = devEnv(PANAMERICA);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Old One', 1)`);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Old Two', 1)`);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    await sql(env, `UPDATE managers SET account_id = ? WHERE name = 'Old One'`, dealer);
    await assert.rejects(sql(env, `UPDATE managers SET account_id = ? WHERE name = 'Old Two'`, dealer), /UNIQUE/);
    await assert.rejects(sql(env, `DELETE FROM owners WHERE id = ?`, dealer), /FOREIGN KEY/);
    await assert.rejects(sql(env, `UPDATE managers SET account_id = 999 WHERE name = 'Old Two'`), /FOREIGN KEY/);
  });

  test("the read-only pre-apply check reports the column, and rollback drops only the index and column", () => {
    const db = createMemoryD1();
    return (async () => {
      const check = `SELECT COUNT(*) AS n FROM pragma_table_info('managers') WHERE name = 'account_id'`;
      assert.equal(Number((await db.prepare(check).bind().first<{ n: number }>())?.n), 1);
      await db.prepare(`DROP INDEX idx_managers_account_id`).bind().run();
      await db.prepare(`ALTER TABLE managers DROP COLUMN account_id`).bind().run();
      assert.equal(Number((await db.prepare(check).bind().first<{ n: number }>())?.n), 0);
      const tables = await db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('managers','manager_share_rates','car_manager_assignments')`)
        .bind()
        .first<{ n: number }>();
      assert.equal(Number(tables?.n), 3);
    })();
  });
});

describe("admin creates and links manager accounts", () => {
  test("create with a new email makes a non-admin account and links it in one write", async () => {
    const env = devEnv(PANAMERICA);
    const created = await createManager(env, "Mia Manager", MANAGER_EMAIL.toUpperCase());
    assert.equal(created.accountEmail, MANAGER_EMAIL);
    const account = await first<{ id: number; is_admin: number; email: string }>(
      env,
      `SELECT id, is_admin, email FROM owners WHERE email = ?`,
      MANAGER_EMAIL
    );
    assert.ok(account);
    assert.equal(Number(account.is_admin), 0);
    assert.equal(created.accountId, Number(account.id));
    assert.equal(await getPasswordHash(requireDb(env), Number(account.id)), null);
  });

  test("create with an email that already has an account is refused and links nothing (any case)", async () => {
    const env = devEnv(PANAMERICA);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    for (const email of [DEALER, DEALER.toUpperCase(), ` ${DEALER} `]) {
      const res = await call(env, "POST", "/api/portal/admin/managers", {
        name: "Dana Manager",
        email,
        shareBps: 1000,
        effectiveFrom: "2026-01-01",
      });
      assert.equal(res.status, 409);
      assert.equal(res.data?.reason, "email_has_account");
      assert.equal(res.text.includes(OWNER_NAME), false);
    }
    // Also for the admin's own email.
    const self = await call(env, "POST", "/api/portal/admin/managers", {
      name: "Self Manager",
      email: PANAMERICA,
      shareBps: 1000,
      effectiveFrom: "2026-01-01",
    });
    assert.equal(self.status, 409);
    const managers = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM managers`);
    assert.equal(Number(managers?.n), 0);
    const linked = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM managers WHERE account_id = ?`, dealer);
    assert.equal(Number(linked?.n), 0);
  });

  test("if any step of the create fails, no account, manager, or rate is left behind", async () => {
    const env = devEnv(PANAMERICA);
    const db = requireDb(env);
    const broken: PortalEnv = {
      ...env,
      DB: {
        batch: db.batch?.bind(db),
        prepare(query: string) {
          if (/INSERT INTO manager_share_rates/.test(query)) throw new Error("simulated failure");
          return db.prepare(query);
        },
      },
    };
    const res = await call(broken, "POST", "/api/portal/admin/managers", {
      name: "Fay Test",
      email: "fay@example.com",
      shareBps: 1000,
      effectiveFrom: "2026-01-01",
    });
    assert.equal(res.status, 500);
    assert.equal(await first(env, `SELECT id FROM owners WHERE email = 'fay@example.com'`), null);
    assert.equal(Number((await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM managers`))?.n), 0);
  });

  test("a phase-1 row gets a new account by email, but an existing account's email never links it", async () => {
    const env = devEnv(PANAMERICA);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`);
    const id = Number((await first<{ id: number }>(env, `SELECT id FROM managers WHERE name = 'Legacy Lee'`))?.id);

    const clash = await call(env, "POST", `/api/portal/admin/managers/${id}/account`, { email: DEALER });
    assert.equal(clash.status, 409);
    assert.equal(clash.data?.reason, "email_has_account");
    assert.equal((await first<{ account_id: number | null }>(env, `SELECT account_id FROM managers WHERE id = ?`, id))?.account_id, null);
    assert.equal(Number((await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM managers WHERE account_id = ?`, dealer))?.n), 0);

    const made = await call(env, "POST", `/api/portal/admin/managers/${id}/account`, { email: "lee@example.com" });
    assert.equal(made.status, 200, made.text);
    const manager = made.data?.manager as { accountId: number; accountEmail: string };
    assert.equal(manager.accountEmail, "lee@example.com");
    assert.equal(Number((await first<{ is_admin: number }>(env, `SELECT is_admin FROM owners WHERE id = ?`, manager.accountId))?.is_admin), 0);

    const again = await call(env, "POST", `/api/portal/admin/managers/${id}/account`, { email: "lee2@example.com" });
    assert.equal(again.status, 409);
    assert.equal(again.data?.reason, "manager_already_linked");
  });

  test("/account race: if the manager is linked in between, no orphan owners row is left and the reply is 409", async () => {
    const env = devEnv(PANAMERICA);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    const db = requireDb(env);
    // Simulate a concurrent explicit link landing just before this create's batch runs.
    const racing: PortalEnv = {
      ...env,
      DB: {
        prepare: (query: string) => db.prepare(query),
        async batch(statements) {
          await db.prepare(`UPDATE managers SET account_id = ? WHERE id = 1`).bind(dealer).run();
          return db.batch!(statements);
        },
      },
    };
    const res = await call(racing, "POST", `/api/portal/admin/managers/1/account`, { email: "lee@example.com" });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.data?.reason, "manager_already_linked");
    assert.equal(await first(env, `SELECT id FROM owners WHERE email = 'lee@example.com'`), null);
    assert.equal(Number((await first<{ account_id: number }>(env, `SELECT account_id FROM managers WHERE id = 1`))?.account_id), dealer);
  });

  test("linking an existing account requires that exact owner id and an explicit confirm", async () => {
    assert.equal(parseAccountLink({ ownerId: 2 }).ok, false);
    assert.equal(parseAccountLink({ ownerId: 2, confirm: "yes" }).ok, false);
    assert.equal(parseAccountLink({ email: DEALER, confirm: true }).ok, false);
    assert.equal(parseAccountLink({ ownerId: 2, email: DEALER, confirm: true }).ok, false);
    assert.equal(parseAccountLink({ ownerId: "2", confirm: true }).ok, false);
    assert.equal(parseAccountLink({ ownerId: 2, confirm: true }).ok, true);

    const env = devEnv(PANAMERICA);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Two', 1)`);
    const lee = 1;
    const two = 2;
    const path = `/api/portal/admin/managers/${lee}/link`;
    assert.equal((await call(env, "POST", path, { email: DEALER, confirm: true })).status, 400);
    assert.equal((await call(env, "POST", path, { ownerId: dealer })).status, 400);
    assert.equal((await call(env, "POST", path, { ownerId: 999, confirm: true })).status, 400);
    assert.equal((await first<{ account_id: number | null }>(env, `SELECT account_id FROM managers WHERE id = ?`, lee))?.account_id, null);

    const linked = await call(env, "POST", path, { ownerId: dealer, confirm: true });
    assert.equal(linked.status, 200, linked.text);
    assert.equal((linked.data?.manager as { accountId: number }).accountId, dealer);

    // That account already has a managers row: refused.
    const dup = await call(env, "POST", `/api/portal/admin/managers/${two}/link`, { ownerId: dealer, confirm: true });
    assert.equal(dup.status, 409);
    assert.equal(dup.data?.reason, "account_has_manager");
    // This manager is already linked: refused.
    const relink = await call(env, "POST", path, { ownerId: 1, confirm: true });
    assert.equal(relink.status, 409);
    assert.equal(relink.data?.reason, "manager_already_linked");
  });

  test("linking a manager row does not grant or revoke is_admin", async () => {
    const env = devEnv(PANAMERICA);
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Dealer As Manager', 1)`);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Admin As Manager', 1)`);
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/1/link`, { ownerId: dealer, confirm: true })).status, 200);
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/2/link`, { ownerId: 1, confirm: true })).status, 200);
    assert.equal(Number((await first<{ is_admin: number }>(env, `SELECT is_admin FROM owners WHERE id = ?`, dealer))?.is_admin), 0);
    assert.equal(Number((await first<{ is_admin: number }>(env, `SELECT is_admin FROM owners WHERE id = 1`))?.is_admin), 1);
    const dealerSession = await call(as(env, DEALER), "GET", "/api/portal/session");
    // No cars owned yet, so only the manager role; admin stays false.
    assert.deepEqual(dealerSession.data?.roles, { admin: false, owner: false, manager: true });
    const adminSession = await call(env, "GET", "/api/portal/session");
    assert.deepEqual(adminSession.data?.roles, { admin: true, owner: false, manager: true });
    assert.equal((await call(as(env, DEALER), "GET", "/api/portal/admin/managers")).status, 403);
  });
});

describe("manager invites", () => {
  test("invite wrapper: refused when unlinked or already passworded, otherwise a /manager/invite/ link on the same API", async () => {
    const db = createMemoryD1();
    const env: PortalEnv = { DB: db, PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA, PORTAL_PEPPER: pepper };
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`);
    const unlinked = await call(env, "POST", `/api/portal/admin/managers/1/invite`);
    assert.equal(unlinked.status, 409);
    assert.equal(unlinked.data?.reason, "manager_not_linked");

    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const minted = await call(env, "POST", `/api/portal/admin/managers/${mia.id}/invite`);
    assert.equal(minted.status, 201, minted.text);
    const token = tokenFrom(minted.data?.url, "manager");
    const row = await getOwnerInviteByHash(db, await sha256Hex(token));
    assert.equal(Number(row?.owner_id), mia.accountId);

    const preview = await call({ DB: db, PORTAL_PEPPER: pepper }, "GET", `/api/portal/invite?t=${token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.data?.email, MANAGER_EMAIL);

    // An explicitly linked account that already has a password: no invite, it signs in as today.
    const dealer = await addOwner(env, OWNER_NAME, DEALER);
    await sql(env, `UPDATE owners SET password_hash = 'x' WHERE id = ?`, dealer);
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Dealer As Manager', 1)`);
    const dm = Number((await first<{ id: number }>(env, `SELECT id FROM managers WHERE name = 'Dealer As Manager'`))?.id);
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/${dm}/link`, { ownerId: dealer, confirm: true })).status, 200);
    const skipped = await call(env, "POST", `/api/portal/admin/managers/${dm}/invite`);
    assert.equal(skipped.status, 409);
    assert.equal(skipped.data?.reason, "account_has_password");
  });

  test("used, expired, and wrong-account tokens fail the same way and never set a password or sign in", async () => {
    const db = createMemoryD1();
    const env: PortalEnv = { DB: db, PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA, PORTAL_PEPPER: pepper };
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const ben = await createManager(env, "Ben Other", OTHER_EMAIL);
    const miaDerived = encodeDerived(await derivePortalKey(MANAGER_EMAIL, password));
    const benDerived = encodeDerived(await derivePortalKey(OTHER_EMAIL, password));

    // Wrong account: Ben's token presented for Mia's email. Not consumed, nothing set.
    const benToken = tokenFrom((await call(env, "POST", `/api/portal/admin/managers/${ben.id}/invite`)).data?.url, "manager");
    const wrong = await send(real, "POST", "/api/portal/invite", {
      body: { token: benToken, email: MANAGER_EMAIL, derived: miaDerived },
    });
    assert.equal(wrong.status, 400);
    assert.deepEqual(wrong.data, { error: "invite_invalid" });
    assert.equal(wrong.setCookie.length, 0);
    assert.equal(await getPasswordHash(db, mia.accountId), null);
    assert.equal(await getPasswordHash(db, ben.accountId), null);
    assert.equal((await getOwnerInviteByHash(db, await sha256Hex(benToken)))?.used_at, null);

    // Used: redeem once correctly (with the matching email), then again.
    const ok = await send(real, "POST", "/api/portal/invite", {
      body: { token: benToken, email: OTHER_EMAIL, derived: benDerived },
    });
    assert.equal(ok.status, 200, ok.text);
    const benHash = await getPasswordHash(db, ben.accountId);
    assert.ok(benHash);
    const reused = await send(real, "POST", "/api/portal/invite", { body: { token: benToken, derived: miaDerived } });
    assert.equal(reused.status, 400);
    assert.deepEqual(reused.data, { error: "invite_invalid" });
    assert.equal(reused.setCookie.length, 0);
    assert.equal(await getPasswordHash(db, ben.accountId), benHash);

    // Expired: Mia's token pushed past its expiry.
    const miaToken = tokenFrom((await call(env, "POST", `/api/portal/admin/managers/${mia.id}/invite`)).data?.url, "manager");
    await sql(env, `UPDATE owner_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?`, await sha256Hex(miaToken));
    const expired = await send(real, "POST", "/api/portal/invite", {
      body: { token: miaToken, email: MANAGER_EMAIL, derived: miaDerived },
    });
    assert.equal(expired.status, 400);
    assert.deepEqual(expired.data, { error: "invite_invalid" });
    assert.equal((await send(real, "GET", `/api/portal/invite?t=${miaToken}`)).status, 400);
    assert.equal(await getPasswordHash(db, mia.accountId), null);

    // None of them authenticate.
    const login = await send(real, "POST", "/api/portal/login", { body: { email: MANAGER_EMAIL, derived: miaDerived } });
    assert.equal(login.status, 401);
    assert.equal(Number((await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM sessions`))?.n), 0);
  });

  test("full flow: invite, set password, sign in with the same login, session reports the manager role", async () => {
    const db = createMemoryD1();
    const env: PortalEnv = { DB: db, PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA, PORTAL_PEPPER: pepper };
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const token = tokenFrom((await call(env, "POST", `/api/portal/admin/managers/${mia.id}/invite`)).data?.url, "manager");
    const derived = encodeDerived(await derivePortalKey(MANAGER_EMAIL, password));
    assert.equal((await send(real, "POST", "/api/portal/invite", { body: { token, email: MANAGER_EMAIL, derived } })).status, 200);
    assert.equal(await getPasswordHash(db, mia.accountId), await sealDerived(pepper, await derivePortalKey(MANAGER_EMAIL, password)));

    const login = await send(real, "POST", "/api/portal/login", { body: { email: MANAGER_EMAIL, derived } });
    assert.equal(login.status, 200, login.text);
    assert.deepEqual(login.data?.roles, { admin: false, owner: false, manager: true });
    assert.equal(login.data?.managerId, mia.id);
    const cookie = login.setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
    assert.ok(cookie);
    const csrf = String(login.data?.csrfToken);

    const session = await send(real, "GET", "/api/portal/session", { cookie });
    assert.deepEqual(session.data?.roles, { admin: false, owner: false, manager: true });
    assert.equal((await send(real, "GET", "/api/portal/manager", { cookie })).status, 200);
    assert.equal((await send(real, "GET", "/api/portal/admin/managers", { cookie })).status, 403);
    // A CSRF-valid write to the manager view is still refused: read-only.
    assert.equal((await send(real, "POST", "/api/portal/manager/cars", { cookie, csrf, body: {} })).status, 405);
    // Logout (an auth write) works.
    assert.equal((await send(real, "POST", "/api/portal/logout", { cookie, csrf })).status, 200);
    assert.equal((await send(real, "GET", "/api/portal/manager", { cookie })).status, 401);
  });

  test("an unlinked phase-1 manager row cannot authenticate or get the manager role", async () => {
    const db = createMemoryD1();
    const env: PortalEnv = { DB: db, PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA, PORTAL_PEPPER: pepper };
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    await sql(env, `INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`);
    const derived = encodeDerived(await derivePortalKey("legacy.lee@example.com", password));
    const login = await send(real, "POST", "/api/portal/login", { body: { email: "legacy.lee@example.com", derived } });
    assert.equal(login.status, 401);
    // An owner account with the same name is not that manager: the role is the account_id link only.
    await addOwner(env, "Legacy Lee", DEALER);
    const dealer = as(env, DEALER);
    assert.equal((await call(dealer, "GET", "/api/portal/manager")).status, 403);
    const session = await call(dealer, "GET", "/api/portal/session");
    assert.deepEqual(session.data?.roles, { admin: false, owner: true, manager: false });
    assert.equal(session.data?.managerId, null);
  });
});

type Fleet = {
  env: PortalEnv;
  mia: { id: number; accountId: number };
  dual: { id: number; accountId: number };
  ben: { id: number; accountId: number };
  dealer: number;
  ownedOnly: number;
  managedOnly: number;
  both: number;
  bensCar: number;
  handedOver: number;
};

/**
 * Mia managed `handedOver` from 2026-09-01 until it went to Ben on 2026-10-15.
 * Dual (an owner who also manages) owns `ownedOnly` and `both`, manages `managedOnly` and `both`.
 * Ben manages `bensCar` and, from 2026-10-15, `handedOver`.
 */
async function fleet(): Promise<Fleet> {
  const env = devEnv(PANAMERICA);
  const dealer = await addOwner(env, OWNER_NAME, DEALER);
  const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
  const ben = await createManager(env, "Ben Other", OTHER_EMAIL);
  const dual = await createManager(env, "Ariel Dual", DUAL_EMAIL);
  const ownedOnly = await addCar(env, dual.accountId, "OWN1");
  const both = await addCar(env, dual.accountId, "BOTH1");
  const managedOnly = await addCar(env, dealer, "MGD1");
  const bensCar = await addCar(env, dealer, "BEN1");
  const handedOver = await addCar(env, dealer, "HAND1");
  await assign(env, managedOnly, dual.id, "2026-09-01");
  await assign(env, both, dual.id, "2026-09-01");
  await assign(env, bensCar, ben.id, "2026-09-01");
  await assign(env, handedOver, mia.id, "2026-09-01");
  await assign(env, handedOver, ben.id, "2026-10-15");
  return { env, mia, dual, ben, dealer, ownedOnly, managedOnly, both, bensCar, handedOver };
}

describe("manager view authz", () => {
  test("signed out: 401 on every manager API", async () => {
    const env: PortalEnv = { DB: createMemoryD1() };
    for (const path of ["/api/portal/manager", "/api/portal/manager/cars", "/api/portal/manager/cars/1", "/api/portal/manager/cars/1/statement", "/api/portal/manager/cars/1/ledger"]) {
      assert.equal((await call(env, "GET", path)).status, 401, path);
    }
  });

  test("signed-in owner who is not a manager: 403 on manager APIs", async () => {
    const f = await fleet();
    const dealer = as(f.env, DEALER);
    for (const path of [
      "/api/portal/manager",
      "/api/portal/manager/cars",
      `/api/portal/manager/cars/${f.managedOnly}`,
      `/api/portal/manager/cars/${f.managedOnly}/statement?month=2026-10`,
      `/api/portal/manager/cars/${f.managedOnly}/ledger`,
    ]) {
      const res = await call(dealer, "GET", path);
      assert.equal(res.status, 403, path);
      assert.equal(res.data?.error, "forbidden");
    }
  });

  test("manager who is not is_admin: 403 not_admin on every admin route, including managers admin and connector docs", async () => {
    const f = await fleet();
    const mia = as(f.env, MANAGER_EMAIL);
    const routes: [string, string][] = [
      ["GET", "/api/portal/admin/managers"],
      ["POST", "/api/portal/admin/managers"],
      ["GET", `/api/portal/admin/managers/${f.mia.id}`],
      ["PATCH", `/api/portal/admin/managers/${f.mia.id}`],
      ["POST", `/api/portal/admin/managers/${f.mia.id}/rates`],
      ["POST", `/api/portal/admin/managers/${f.mia.id}/account`],
      ["POST", `/api/portal/admin/managers/${f.mia.id}/link`],
      ["POST", `/api/portal/admin/managers/${f.mia.id}/invite`],
      ["GET", `/api/portal/admin/cars/${f.handedOver}/managers`],
      ["POST", `/api/portal/admin/cars/${f.handedOver}/managers`],
      ["POST", `/api/portal/admin/cars/${f.handedOver}/managers/undo`],
      ["GET", "/api/portal/admin/connector-capabilities"],
      ["GET", "/api/portal/admin/owners"],
      ["POST", "/api/portal/admin/owners/1/invite"],
      ["GET", "/api/portal/admin/cars"],
      ["GET", `/api/portal/admin/cars/${f.handedOver}`],
      ["GET", `/api/portal/admin/cars/${f.handedOver}/statement`],
      ["GET", `/api/portal/admin/cars/${f.handedOver}/report`],
      ["GET", "/api/portal/admin/imports"],
    ];
    for (const [method, path] of routes) {
      const res = await call(mia, method, path, method === "GET" ? undefined : {});
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.data?.reason, "not_admin", `${method} ${path}`);
    }
  });

  test("dual-role account that is not is_admin: 403 on approval and payout routes", async () => {
    const f = await fleet();
    const dual = as(f.env, DUAL_EMAIL);
    for (const carId of [f.both, f.managedOnly, f.ownedOnly]) {
      for (const [method, path, body] of [
        ["POST", `/api/portal/admin/cars/${carId}/payouts`, { periodMonth: "2026-10", paidDate: "2026-11-01", amountCents: 100 }],
        ["DELETE", `/api/portal/admin/cars/${carId}/payouts/1`, undefined],
        ["POST", `/api/portal/admin/cars/${carId}/expenses`, { entryDate: "2026-10-02", category: "cleaning", amountCents: 100 }],
        ["PATCH", `/api/portal/admin/cars/${carId}/expenses/1`, { amountCents: 1 }],
        ["DELETE", `/api/portal/admin/cars/${carId}/expenses/1`, undefined],
        ["POST", `/api/portal/admin/cars/${carId}/ledger`, { entryDate: "2026-10-02", type: "other", amountCents: 100 }],
      ] as [string, string, unknown][]) {
        const res = await call(dual, method, path, body);
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal(res.data?.reason, "not_admin");
      }
    }
    for (const path of ["/api/portal/admin/imports/1/commit", "/api/portal/admin/imports/1/discard"]) {
      assert.equal((await call(dual, "POST", path, {})).status, 403, path);
    }
    assert.equal(Number((await first<{ n: number }>(f.env, `SELECT COUNT(*) AS n FROM payouts`))?.n), 0);
    assert.equal(Number((await first<{ n: number }>(f.env, `SELECT COUNT(*) AS n FROM expenses`))?.n), 0);
  });

  test("dual role: owned-only car only in the owner view, managed-only only in the manager view, owned+managed in both", async () => {
    const f = await fleet();
    const dual = as(f.env, DUAL_EMAIL);
    const session = await call(dual, "GET", "/api/portal/session");
    assert.deepEqual(session.data?.roles, { admin: false, owner: true, manager: true });
    assert.equal(session.data?.managerId, f.dual.id);

    const owned = ((await call(dual, "GET", "/api/portal/cars")).data?.cars as { id: number }[]).map((c) => c.id).sort();
    assert.deepEqual(owned, [f.ownedOnly, f.both].sort());
    const managed = ((await call(dual, "GET", "/api/portal/manager/cars")).data?.cars as { id: number }[]).map((c) => c.id).sort();
    assert.deepEqual(managed, [f.managedOnly, f.both].sort());

    // Owning does not open the manager view; managing does not open the owner statement.
    assert.equal((await call(dual, "GET", `/api/portal/manager/cars/${f.ownedOnly}`)).status, 404);
    assert.equal((await call(dual, "GET", `/api/portal/manager/cars/${f.ownedOnly}/statement?month=2026-10`)).status, 404);
    for (const suffix of ["", "/statement", "/report", "/payouts", "/expenses"]) {
      assert.equal((await call(dual, "GET", `/api/portal/cars/${f.managedOnly}${suffix}`)).status, 404, suffix);
    }
    // Owned and managed: each view works with its own scope.
    assert.equal((await call(dual, "GET", `/api/portal/cars/${f.both}/statement`)).status, 200);
    assert.equal((await call(dual, "GET", `/api/portal/manager/cars/${f.both}/statement?month=2026-10`)).status, 200);
    // Owning a car does not widen the manager window: before the assignment start is outside.
    await addTrip(f.env, f.both, "BOTH-AUG", "2026-08-20", "2026-08-22", 30000);
    assert.equal((await call(dual, "GET", `/api/portal/manager/cars/${f.both}/statement?month=2026-08`)).status, 404);
    const ownerReport = await call(dual, "GET", `/api/portal/cars/${f.both}/report?month=2026-08`);
    assert.equal(ownerReport.status, 200);
  });

  test("manager cannot read a car with no assignment, including another manager's car (404)", async () => {
    const f = await fleet();
    const mia = as(f.env, MANAGER_EMAIL);
    for (const carId of [f.bensCar, f.managedOnly, f.ownedOnly, 9999]) {
      for (const suffix of ["", "/statement?month=2026-10", "/ledger"]) {
        assert.equal((await call(mia, "GET", `/api/portal/manager/cars/${carId}${suffix}`)).status, 404, `${carId}${suffix}`);
      }
    }
    const cars = (await call(mia, "GET", "/api/portal/manager/cars")).data?.cars as { id: number }[];
    assert.deepEqual(cars.map((c) => c.id), [f.handedOver]);
    // Never another manager's accrual, rates, or assignments.
    const self = await call(mia, "GET", "/api/portal/manager");
    assert.deepEqual((self.data?.assignments as { carId: number }[]).map((a) => a.carId), [f.handedOver]);
    assert.equal((self.data?.manager as { id: number }).id, f.mia.id);
    assert.equal(self.text.includes("Ben Other"), false);
  });

  test("after reassignment: reads inside the closed window succeed; months on or after end_date do not", async () => {
    const f = await fleet();
    const mia = as(f.env, MANAGER_EMAIL);
    await addTrip(f.env, f.handedOver, "H-SEP", "2026-09-10", "2026-09-12", 50000);
    await addExpense(f.env, f.handedOver, "2026-09-11", 2500);
    for (const month of ["2026-09", "2026-10"]) {
      assert.equal((await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/statement?month=${month}`)).status, 200, month);
      assert.equal((await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/ledger?month=${month}`)).status, 200, month);
    }
    for (const month of ["2026-11", "2026-12", "2026-08"]) {
      const res = await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/statement?month=${month}`);
      assert.equal(res.status, 404, month);
      assert.equal(res.data?.reason, "outside_assignment");
      assert.equal((await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/ledger?month=${month}`)).status, 404, month);
    }
    const car = await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}`);
    assert.equal(car.status, 200);
    const json = car.data?.car as { current: boolean; windows: unknown; months: string[] };
    assert.equal(json.current, false);
    assert.deepEqual(json.windows, [{ startDate: "2026-09-01", endDate: "2026-10-15" }]);
    assert.deepEqual(json.months, ["2026-09", "2026-10"]);
  });

  test("a month straddling end_date: earnings, statement, and log rows on or after end_date are omitted", async () => {
    const f = await fleet();
    await startLedgerEarly(f.env, f.handedOver);
    const mia = as(f.env, MANAGER_EMAIL);
    const ben = as(f.env, OTHER_EMAIL);
    // Inside Mia's window (Oct 1 - Oct 14).
    await addTrip(f.env, f.handedOver, "H-IN", "2026-10-03", "2026-10-06", 50000); // 3 days: 20% fee 10000, 25% share 2500
    await addTrip(f.env, f.handedOver, "H-LAST", "2026-10-14", "2026-10-16", 40000); // starts the last day: Mia's
    await addExpense(f.env, f.handedOver, "2026-10-05", 1500);
    await addExpense(f.env, f.handedOver, "2026-10-14", 700);
    await addLedger(f.env, f.handedOver, "2026-10-04", "maintenance", 900);
    // On or after end_date (Oct 15): Ben's, not Mia's.
    await addTrip(f.env, f.handedOver, "H-END", "2026-10-15", "2026-10-18", 60000);
    await addTrip(f.env, f.handedOver, "H-LATE", "2026-10-20", "2026-10-25", 70000);
    await addExpense(f.env, f.handedOver, "2026-10-15", 3300);
    await addExpense(f.env, f.handedOver, "2026-10-28", 4400);
    await addLedger(f.env, f.handedOver, "2026-10-15", "cleaning", 1100);
    await addLedger(f.env, f.handedOver, "2026-10-29", "tolls", 1200);
    // Owner payout rows never show in the manager log.
    await addLedger(f.env, f.handedOver, "2026-10-05", "payout", 9999);

    const statement = await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/statement?month=2026-10`);
    assert.equal(statement.status, 200);
    const data = statement.data as {
      windows: unknown;
      trips: { startDate: string; feeCents: number; shareCents: number }[];
      expenses: { entryDate: string }[];
      totals: { tripCount: number; incomeCents: number; expenseCents: number; feeCents: number; shareCents: number };
    };
    assert.deepEqual(data.windows, [{ startDate: "2026-10-01", endDate: "2026-10-15" }]);
    assert.deepEqual(data.trips.map((t) => t.startDate), ["2026-10-03", "2026-10-14"]);
    assert.deepEqual(data.expenses.map((e) => e.entryDate), ["2026-10-05", "2026-10-14"]);
    assert.equal(data.totals.incomeCents, 90000);
    assert.equal(data.totals.expenseCents, 2200);
    assert.equal(data.totals.feeCents, 10000 + 8000);
    assert.equal(data.totals.shareCents, 2500 + 2000);

    const ledger = await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/ledger?month=2026-10`);
    assert.deepEqual((ledger.data?.entries as { entryDate: string; type: string }[]).map((e) => [e.entryDate, e.type]), [["2026-10-04", "maintenance"]]);
    const allLedger = await call(mia, "GET", `/api/portal/manager/cars/${f.handedOver}/ledger`);
    assert.deepEqual((allLedger.data?.entries as { entryDate: string }[]).map((e) => e.entryDate), ["2026-10-04"]);
    assert.equal(allLedger.text.includes("9999"), false);

    const self = await call(mia, "GET", "/api/portal/manager");
    const accrual = self.data?.accrual as { trips: { startDate: string }[]; accruedCents: number; months: { month: string; shareCents: number }[] };
    assert.deepEqual(accrual.trips.map((t) => t.startDate), ["2026-10-03", "2026-10-14"]);
    assert.equal(accrual.accruedCents, 4500);
    assert.deepEqual(accrual.months.map((m) => [m.month, m.shareCents]), [["2026-10", 4500]]);

    // The incoming manager sees the other side of the same month, and nothing before their start.
    const benStatement = await call(ben, "GET", `/api/portal/manager/cars/${f.handedOver}/statement?month=2026-10`);
    const benData = benStatement.data as { trips: { startDate: string }[]; expenses: { entryDate: string }[] };
    assert.deepEqual(benData.trips.map((t) => t.startDate), ["2026-10-15", "2026-10-20"]);
    assert.deepEqual(benData.expenses.map((e) => e.entryDate), ["2026-10-15", "2026-10-28"]);
    const benLedger = await call(ben, "GET", `/api/portal/manager/cars/${f.handedOver}/ledger?month=2026-10`);
    assert.deepEqual((benLedger.data?.entries as { entryDate: string }[]).map((e) => e.entryDate), ["2026-10-15", "2026-10-29"]);
    assert.equal((await call(ben, "GET", `/api/portal/manager/cars/${f.handedOver}/statement?month=2026-09`)).status, 404);
  });

  test("manager JSON (self, list, car, statement, log) never includes owner name or email, payouts, or guest fields", async () => {
    const f = await fleet();
    await addTrip(f.env, f.managedOnly, "M-1", "2026-10-03", "2026-10-06", 50000);
    await addExpense(f.env, f.managedOnly, "2026-10-05", 1500);
    await addLedger(f.env, f.managedOnly, "2026-10-04", "maintenance", 900);
    await sql(f.env, `INSERT INTO payouts (car_id, period_month, paid_date, amount_cents, created_by) VALUES (?, '2026-10', '2026-11-01', 777, 1)`, f.managedOnly);
    const dual = as(f.env, DUAL_EMAIL);
    for (const path of [
      "/api/portal/manager",
      "/api/portal/manager/cars",
      `/api/portal/manager/cars/${f.managedOnly}`,
      `/api/portal/manager/cars/${f.managedOnly}/statement?month=2026-10`,
      `/api/portal/manager/cars/${f.managedOnly}/ledger?month=2026-10`,
      `/api/portal/manager/cars/${f.managedOnly}/ledger`,
    ]) {
      const res = await call(dual, "GET", path);
      assert.equal(res.status, 200, path);
      for (const banned of [OWNER_NAME, DEALER, "ownerName", "ownerEmail", "owner_name", "owner_email", "payout", "guest", "externalTripId", "M-1"]) {
        assert.equal(res.text.includes(banned), false, `${path} leaked ${banned}`);
      }
    }
    const car = (await call(dual, "GET", `/api/portal/manager/cars/${f.managedOnly}`)).data?.car as Record<string, unknown>;
    assert.equal(car.ownerId, f.dealer);
    assert.deepEqual(
      Object.keys(car).sort(),
      ["color", "current", "id", "licensePlate", "make", "model", "months", "ownerId", "vin", "windows", "year"]
    );
  });

  test("phase 2 is read-only: manager routes reject trips, expenses, assignments, rates, and reimbursement writes", async () => {
    const f = await fleet();
    const mia = as(f.env, MANAGER_EMAIL);
    const car = f.handedOver;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of [
        "/api/portal/manager",
        "/api/portal/manager/cars",
        `/api/portal/manager/cars/${car}`,
        `/api/portal/manager/cars/${car}/statement`,
        `/api/portal/manager/cars/${car}/ledger`,
        `/api/portal/manager/cars/${car}/trips`,
        `/api/portal/manager/cars/${car}/expenses`,
        `/api/portal/manager/cars/${car}/managers`,
        `/api/portal/manager/rates`,
        `/api/portal/manager/reimbursements`,
      ]) {
        const res = await call(mia, method, path, { amountCents: 100, entryDate: "2026-09-05", category: "cleaning" });
        assert.equal(res.status, 405, `${method} ${path}`);
      }
    }
    for (const table of ["expenses", "trips", "car_ledger", "payouts"]) {
      assert.equal(Number((await first<{ n: number }>(f.env, `SELECT COUNT(*) AS n FROM ${table}`))?.n), 0, table);
    }
    assert.equal(Number((await first<{ n: number }>(f.env, `SELECT COUNT(*) AS n FROM manager_share_rates`))?.n), 3);
    assert.equal(Number((await first<{ n: number }>(f.env, `SELECT COUNT(*) AS n FROM car_manager_assignments`))?.n), 5);
  });

  test("session reports the manager role only when account_id matches, and owner + manager together", async () => {
    const f = await fleet();
    const cases: [string, { admin: boolean; owner: boolean; manager: boolean }, number | null][] = [
      [DEALER, { admin: false, owner: true, manager: false }, null],
      [MANAGER_EMAIL, { admin: false, owner: false, manager: true }, f.mia.id],
      [DUAL_EMAIL, { admin: false, owner: true, manager: true }, f.dual.id],
      [PANAMERICA, { admin: true, owner: true, manager: false }, null],
    ];
    for (const [email, roles, managerId] of cases) {
      const session = await call(as(f.env, email), "GET", "/api/portal/session");
      assert.deepEqual(session.data?.roles, roles, email);
      assert.equal(session.data?.managerId, managerId, email);
    }
  });
});

/** A database as if 0009 was never applied, or was rolled back. */
async function preAccountsDb() {
  const db = createMemoryD1();
  await db.prepare(`DROP INDEX idx_managers_account_id`).bind().run();
  await db.prepare(`ALTER TABLE managers DROP COLUMN account_id`).bind().run();
  return db;
}

describe("sessions survive a missing 0009 (deploy order safety)", () => {
  test("pre-0009 schema: login and /session return 200 with roles.manager false; manager API is 403, not 500", async () => {
    const db = await preAccountsDb();
    const real: PortalEnv = { DB: db, PORTAL_PEPPER: pepper };
    const derived = encodeDerived(await derivePortalKey(PANAMERICA, password));
    await db
      .prepare(`UPDATE owners SET password_hash = ? WHERE id = 1`)
      .bind(await sealDerived(pepper, await derivePortalKey(PANAMERICA, password)))
      .run();
    await db.prepare(`INSERT INTO managers (name, created_by) VALUES ('Legacy Lee', 1)`).bind().run();

    const login = await send(real, "POST", "/api/portal/login", { body: { email: PANAMERICA, derived } });
    assert.equal(login.status, 200, login.text);
    assert.deepEqual(login.data?.roles, { admin: true, owner: true, manager: false });
    assert.equal(login.data?.managerId, null);
    const cookie = login.setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
    assert.ok(cookie);

    const session = await send(real, "GET", "/api/portal/session", { cookie });
    assert.equal(session.status, 200, session.text);
    assert.deepEqual(session.data?.roles, { admin: true, owner: true, manager: false });
    assert.equal((await send(real, "GET", "/api/portal/cars", { cookie })).status, 200);
    const manager = await send(real, "GET", "/api/portal/manager", { cookie });
    assert.equal(manager.status, 403);
    assert.equal(manager.data?.reason, "not_manager");

    // Dev-auth session (owner without cars) as well.
    await db.prepare(`INSERT INTO owners (name, email, is_admin) VALUES ('Dealer', ?, 0)`).bind(DEALER).run();
    const dealer = await call({ DB: db, PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: DEALER }, "GET", "/api/portal/session");
    assert.equal(dealer.status, 200);
    assert.deepEqual(dealer.data?.roles, { admin: false, owner: true, manager: false });
  });

  test("only the missing account_id column is tolerated; any other error still fails", async () => {
    assert.equal(isMissingAccountColumn(new Error("D1_ERROR: no such column: account_id: SQLITE_ERROR")), true);
    assert.equal(isMissingAccountColumn(new Error("no such column: m.account_id")), true);
    assert.equal(isMissingAccountColumn(new Error("no such column: name")), false);
    assert.equal(isMissingAccountColumn(new Error("no such table: managers")), false);
    assert.equal(isMissingAccountColumn(new Error("D1_ERROR: network")), false);

    const db = createMemoryD1();
    const broken: PortalEnv = {
      PORTAL_DEV_AUTH: "1",
      PORTAL_DEV_EMAIL: PANAMERICA,
      DB: {
        batch: db.batch?.bind(db),
        prepare(query: string) {
          if (/FROM managers WHERE account_id/.test(query)) throw new Error("D1_ERROR: database is locked");
          return db.prepare(query);
        },
      },
    };
    assert.equal((await call(broken, "GET", "/api/portal/session")).status, 500);
  });
});

describe("manager surface", () => {
  test("/manager/ and /manager/invite/ are portal surfaces: apex redirects to www like /owner/", () => {
    for (const path of ["/manager", "/manager/", "/manager/invite/"]) assert.equal(isPortalSurface(path), true, path);
    const redirect = portalApexRedirect(new Request("https://panamericafleet.com/manager/invite/?t=x"));
    assert.equal(redirect?.status, 308);
    assert.equal(redirect?.headers.get("location"), "https://www.panamericafleet.com/manager/invite/?t=x");
  });
});

describe("assignment window helpers", () => {
  const windows = [
    { startDate: "2026-09-01", endDate: "2026-10-15" },
    { startDate: "2026-12-10", endDate: null },
  ];
  test("inWindows is start inclusive, end exclusive", () => {
    assert.equal(inWindows(windows, "2026-08-31"), false);
    assert.equal(inWindows(windows, "2026-09-01"), true);
    assert.equal(inWindows(windows, "2026-10-14"), true);
    assert.equal(inWindows(windows, "2026-10-15"), false);
    assert.equal(inWindows(windows, "2026-12-09"), false);
    assert.equal(inWindows(windows, "2030-01-01"), true);
  });
  test("clipWindows cuts to the month and drops windows that miss it", () => {
    assert.deepEqual(clipWindows(windows, { start: "2026-10-01", end: "2026-11-01" }), [{ startDate: "2026-10-01", endDate: "2026-10-15" }]);
    assert.deepEqual(clipWindows(windows, { start: "2026-11-01", end: "2026-12-01" }), []);
    assert.deepEqual(clipWindows(windows, { start: "2026-12-01", end: "2027-01-01" }), [{ startDate: "2026-12-10", endDate: "2027-01-01" }]);
  });
  test("windowMonths lists covered months, end exclusive, capped at the current month", () => {
    assert.deepEqual(windowMonths(windows, "2027-01"), ["2026-09", "2026-10", "2026-12", "2027-01"]);
    assert.deepEqual(windowMonths([{ startDate: "2026-09-01", endDate: "2026-10-01" }], "2027-01"), ["2026-09"]);
  });
});
