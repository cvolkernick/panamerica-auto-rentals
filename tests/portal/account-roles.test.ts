/**
 * Adding owners and managers from either a new login or an existing account, and the manager
 * invite flow matching the owner one (docs/manager-role.md, "Owner role" and "Invites").
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";

import { getPasswordHash } from "../../lib/portal/db";
import { derivePortalKey, encodeDerived } from "../../lib/portal/derive";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { isMissingOwnerRoleColumn, ownerRoleFrom } from "../../lib/portal/owner-role";
import { parseManagerFromAccount } from "../../lib/portal/managers";
import { createMemoryD1, loadMigrationSql } from "./memory-d1";
import { call, DEALER, PANAMERICA, requireDb } from "./support";

const MANAGER_EMAIL = "mia.manager@example.com";
const OWNER_EMAIL = "olive.owner@example.com";

let pepper = "";
let password = "";

before(() => {
  pepper = randomBytes(32).toString("base64url");
  password = randomBytes(18).toString("base64url");
});

function adminEnv(): PortalEnv {
  return { DB: createMemoryD1(), PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: PANAMERICA, PORTAL_PEPPER: pepper };
}

function as(env: PortalEnv, email: string): PortalEnv {
  return { ...env, PORTAL_DEV_EMAIL: email };
}

async function sql(env: PortalEnv, query: string, ...values: (string | number | null)[]) {
  return requireDb(env).prepare(query).bind(...values).run();
}

async function addOwner(env: PortalEnv, name: string, email: string): Promise<number> {
  const result = await sql(env, `INSERT INTO owners (name, email, is_admin) VALUES (?, ?, 0)`, name, email);
  return Number(result.meta.last_row_id);
}

async function createManager(env: PortalEnv, name: string, email: string) {
  const res = await call(env, "POST", "/api/portal/admin/managers", {
    name,
    email,
    shareBps: 2500,
    effectiveFrom: "2026-01-01",
  });
  assert.equal(res.status, 201, res.text);
  return res.data?.manager as { id: number; accountId: number; accountEmail: string };
}

type AccountRow = { id: number; email: string; roles?: { owner: boolean; manager: boolean } };

async function accounts(env: PortalEnv): Promise<AccountRow[]> {
  const res = await call(env, "GET", "/api/portal/admin/owners");
  assert.equal(res.status, 200, res.text);
  return res.data?.owners as AccountRow[];
}

async function invite(env: PortalEnv, managerId: number, body?: unknown) {
  return call(env, "POST", `/api/portal/admin/managers/${managerId}/invite`, body);
}

function tokenOf(url: unknown): string {
  const parsed = new URL(String(url));
  assert.equal(parsed.origin + parsed.pathname, "https://www.panamericafleet.com/manager/invite/");
  return parsed.searchParams.get("t") ?? "";
}

async function redeem(env: PortalEnv, token: string, email: string) {
  const derived = encodeDerived(await derivePortalKey(email, password));
  const response = await handlePortal(
    new Request("http://127.0.0.1/api/portal/invite", {
      method: "POST",
      headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ token, email, derived }),
    }),
    { DB: env.DB, PORTAL_PEPPER: pepper }
  );
  return response.status;
}

describe("migration 0010: owners.owner_role", () => {
  test("adds one nullable column only; no data changes", () => {
    const text = loadMigrationSql("0010_owner_role.sql");
    const statements = text.replace(/--.*$/gm, "");
    assert.match(statements, /ALTER TABLE owners ADD COLUMN owner_role INTEGER;/);
    assert.doesNotMatch(statements, /NOT NULL|DEFAULT/i);
    assert.doesNotMatch(statements, /^\s*(INSERT|UPDATE|DELETE|DROP)\b/im);
    assert.match(text, /pragma_table_info\('owners'\)/);
  });

  test("role rule: owns a car, granted, or not a manager", () => {
    assert.equal(ownerRoleFrom({ ownsCars: false, granted: false, manager: true }), false);
    assert.equal(ownerRoleFrom({ ownsCars: true, granted: false, manager: true }), true);
    assert.equal(ownerRoleFrom({ ownsCars: false, granted: true, manager: true }), true);
    assert.equal(ownerRoleFrom({ ownsCars: false, granted: false, manager: false }), true);
    assert.equal(isMissingOwnerRoleColumn(new Error("D1_ERROR: no such column: owner_role")), true);
    assert.equal(isMissingOwnerRoleColumn(new Error("no such column: account_id")), false);
  });
});

describe("adding an owner from an existing account", () => {
  test("the owners list reports roles; a manager-only login is not an owner until granted", async () => {
    const env = adminEnv();
    const owner = await addOwner(env, "Olive Owner", OWNER_EMAIL);
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const rows = await accounts(env);
    assert.deepEqual(rows.find((r) => r.id === owner)?.roles, { owner: true, manager: false });
    assert.deepEqual(rows.find((r) => r.id === mia.accountId)?.roles, { owner: false, manager: true });
  });

  test("grant needs the exact id and confirm: true, never an email; then the session has both roles", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const path = `/api/portal/admin/owners/${mia.accountId}/owner-role`;

    const noConfirm = await call(env, "POST", path, {});
    assert.equal(noConfirm.status, 400);
    assert.ok((noConfirm.data?.fields as Record<string, string>).confirm);
    assert.equal((await call(env, "POST", path, { confirm: "yes" })).status, 400);
    assert.equal((await call(env, "POST", path, { email: MANAGER_EMAIL })).status, 400);
    assert.equal((await call(env, "POST", "/api/portal/admin/owners/999/owner-role", { confirm: true })).status, 404);
    assert.equal((await call(env, "GET", path)).status, 405);
    let session = await call(as(env, MANAGER_EMAIL), "GET", "/api/portal/session");
    assert.deepEqual(session.data?.roles, { admin: false, owner: false, manager: true });

    const ok = await call(env, "POST", path, { confirm: true });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual((ok.data?.owner as AccountRow).roles, { owner: true, manager: true });
    session = await call(as(env, MANAGER_EMAIL), "GET", "/api/portal/session");
    assert.deepEqual(session.data?.roles, { admin: false, owner: true, manager: true });
    assert.equal(session.data?.managerId, mia.id);
    // Same login: no second account, no password change, admin untouched.
    assert.equal((await accounts(env)).filter((r) => r.email === MANAGER_EMAIL).length, 1);
    assert.equal(await getPasswordHash(requireDb(env), mia.accountId), null);
    // Idempotent.
    assert.equal((await call(env, "POST", path, { confirm: true })).status, 200);
  });

  test("a car added for the manager's account also makes them an owner (no grant needed)", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const car = await call(env, "POST", "/api/portal/admin/cars", {
      ownerId: String(mia.accountId),
      year: "2024",
      make: "Tesla",
      model: "Model Y",
      color: "White",
      licensePlate: "MIA1",
      vin: "5YJYGDEE0MF000001",
    });
    assert.equal(car.status, 201, car.text);
    const row = (await accounts(env)).find((r) => r.id === mia.accountId);
    assert.deepEqual(row?.roles, { owner: true, manager: true });
  });

  test("non-admin cannot grant", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    await addOwner(env, "Dana Dealer", DEALER);
    const res = await call(as(env, DEALER), "POST", `/api/portal/admin/owners/${mia.accountId}/owner-role`, { confirm: true });
    assert.equal(res.status, 403);
  });

  test("before migration 0010: reads still work and the grant says migration_pending", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    await sql(env, `ALTER TABLE owners DROP COLUMN owner_role`);
    const rows = await accounts(env);
    assert.deepEqual(rows.find((r) => r.id === mia.accountId)?.roles, { owner: false, manager: true });
    const session = await call(as(env, MANAGER_EMAIL), "GET", "/api/portal/session");
    assert.deepEqual(session.data?.roles, { admin: false, owner: false, manager: true });
    const res = await call(env, "POST", `/api/portal/admin/owners/${mia.accountId}/owner-role`, { confirm: true });
    assert.equal(res.status, 409);
    assert.equal(res.data?.reason, "migration_pending");
  });

  test("new-owner create with an email that already has a login is refused and points to Existing account", async () => {
    const env = adminEnv();
    await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const res = await call(env, "POST", "/api/portal/admin/owners", { name: "Mia", email: MANAGER_EMAIL, storedAdmin: "0" });
    assert.equal(res.status, 409);
    assert.match(String((res.data?.fields as Record<string, string>).email), /Existing account/);
    assert.equal((await accounts(env)).filter((r) => r.email === MANAGER_EMAIL).length, 1);
  });
});

describe("adding a manager from an existing account", () => {
  test("explicit id + confirm links the existing login with its first rate; no new account", async () => {
    const env = adminEnv();
    const owner = await addOwner(env, "Olive Owner", OWNER_EMAIL);
    const before = (await accounts(env)).length;
    const body = { name: "Olive Manager", ownerId: owner, confirm: true, shareBps: 1500, effectiveFrom: "2026-02-01" };

    assert.equal((await call(env, "POST", "/api/portal/admin/managers", { ...body, confirm: false })).status, 400);
    const withEmail = await call(env, "POST", "/api/portal/admin/managers", { ...body, email: OWNER_EMAIL });
    assert.equal(withEmail.status, 400);
    assert.equal((await call(env, "POST", "/api/portal/admin/managers", { ...body, ownerId: 999 })).status, 400);

    const res = await call(env, "POST", "/api/portal/admin/managers", body);
    assert.equal(res.status, 201, res.text);
    const manager = res.data?.manager as { id: number; accountId: number; shareBps: number; accountEmail: string };
    assert.equal(manager.accountId, owner);
    assert.equal(manager.accountEmail, OWNER_EMAIL);
    assert.equal((await accounts(env)).length, before);
    // Same rule as the existing link route: with no car and no grant, the account is manager-only
    // until the admin adds the owner role (Existing account on /admin/) or adds their car.
    assert.deepEqual((await accounts(env)).find((r) => r.id === owner)?.roles, { owner: false, manager: true });
    assert.equal((await call(env, "POST", `/api/portal/admin/owners/${owner}/owner-role`, { confirm: true })).status, 200);
    assert.deepEqual((await accounts(env)).find((r) => r.id === owner)?.roles, { owner: true, manager: true });

    const again = await call(env, "POST", "/api/portal/admin/managers", { ...body, name: "Olive Two" });
    assert.equal(again.status, 409);
    assert.equal(again.data?.reason, "account_has_manager");
  });

  test("parser refuses email and missing fields", () => {
    assert.equal(parseManagerFromAccount({ ownerId: 1, confirm: true, name: "A", shareBps: 100, effectiveFrom: "2026-01-01" }).ok, true);
    assert.equal(parseManagerFromAccount({ ownerId: 1, confirm: true, name: "A", email: "a@b.co", shareBps: 100, effectiveFrom: "2026-01-01" }).ok, false);
    assert.equal(parseManagerFromAccount({ ownerId: 1, name: "A", shareBps: 100, effectiveFrom: "2026-01-01" }).ok, false);
    assert.equal(parseManagerFromAccount({ ownerId: 1, confirm: true, shareBps: 100, effectiveFrom: "2026-01-01" }).ok, false);
  });
});

describe("manager invites work like owner invites", () => {
  test("new manager: link right away, a newer link replaces the older one, set password, sign in", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const first = await invite(env, mia.id);
    assert.equal(first.status, 201, first.text);
    const second = await invite(env, mia.id);
    assert.equal(second.status, 201);
    const oldToken = tokenOf(first.data?.url);
    const newToken = tokenOf(second.data?.url);
    assert.notEqual(oldToken, newToken);
    assert.equal(await redeem(env, oldToken, MANAGER_EMAIL), 400);
    assert.equal(await redeem(env, newToken, MANAGER_EMAIL), 200);
    assert.ok(await getPasswordHash(requireDb(env), mia.accountId));
  });

  test("after the password is set, a new link needs { reset: true }, like a password reset", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    assert.equal(await redeem(env, tokenOf((await invite(env, mia.id)).data?.url), MANAGER_EMAIL), 200);
    const hash = await getPasswordHash(requireDb(env), mia.accountId);

    const refused = await invite(env, mia.id);
    assert.equal(refused.status, 409);
    assert.equal(refused.data?.reason, "account_has_password");
    assert.equal((await invite(env, mia.id, { reset: "yes" })).status, 409);

    const reset = await invite(env, mia.id, { reset: true });
    assert.equal(reset.status, 201, reset.text);
    assert.equal(await getPasswordHash(requireDb(env), mia.accountId), hash);
    assert.equal(await redeem(env, tokenOf(reset.data?.url), MANAGER_EMAIL), 200);
  });

  test("owner invite route and manager invite route mint the same kind of token for the same account", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const viaOwners = await call(env, "POST", `/api/portal/admin/owners/${mia.accountId}/invite`);
    assert.equal(viaOwners.status, 201);
    const viaManagers = await invite(env, mia.id);
    assert.equal(viaManagers.status, 201);
    assert.equal(viaOwners.data?.expiresAt !== undefined && viaManagers.data?.expiresAt !== undefined, true);
    // The newer manager link replaced the owner link (same table, same rule).
    const ownerToken = new URL(String(viaOwners.data?.url)).searchParams.get("t") ?? "";
    assert.equal(await redeem(env, ownerToken, MANAGER_EMAIL), 400);
  });
});

describe("follow-ups to #37: owners-list reset guard and grant input", () => {
  test("owners-list invite for a dual-role account with a password needs { reset: true }", async () => {
    const env = adminEnv();
    const owner = await addOwner(env, "Olive Owner", OWNER_EMAIL);
    // Plain owner with a password: unchanged, a new link is still a password reset.
    await sql(env, `UPDATE owners SET password_hash = 'x' WHERE id = ?`, owner);
    assert.equal((await call(env, "POST", `/api/portal/admin/owners/${owner}/invite`)).status, 201);

    // Dual role without a password yet: no guard (first invite).
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    assert.equal((await call(env, "POST", `/api/portal/admin/owners/${mia.accountId}/invite`)).status, 201);
    assert.equal(await redeem(env, tokenOf((await invite(env, mia.id)).data?.url), MANAGER_EMAIL), 200);

    // Dual role with a password: refused without reset, also for a junk body or reset: "yes".
    const path = `/api/portal/admin/owners/${mia.accountId}/invite`;
    for (const body of [undefined, {}, { reset: "yes" }]) {
      const refused = await call(env, "POST", path, body);
      assert.equal(refused.status, 409, JSON.stringify(body));
      assert.equal(refused.data?.reason, "account_has_password");
    }
    const hash = await getPasswordHash(requireDb(env), mia.accountId);
    const reset = await call(env, "POST", path, { reset: true });
    assert.equal(reset.status, 201, reset.text);
    assert.equal(await getPasswordHash(requireDb(env), mia.accountId), hash);

    // Same for an owner linked as a manager from an existing account.
    const linked = await call(env, "POST", "/api/portal/admin/managers", {
      name: "Olive Manager",
      ownerId: owner,
      confirm: true,
      shareBps: 1000,
      effectiveFrom: "2026-03-01",
    });
    assert.equal(linked.status, 201, linked.text);
    assert.equal((await call(env, "POST", `/api/portal/admin/owners/${owner}/invite`)).data?.reason, "account_has_password");
  });

  test("owner-role grant refuses an email field even with confirm: true", async () => {
    const env = adminEnv();
    const mia = await createManager(env, "Mia Manager", MANAGER_EMAIL);
    const res = await call(env, "POST", `/api/portal/admin/owners/${mia.accountId}/owner-role`, {
      confirm: true,
      email: MANAGER_EMAIL,
    });
    assert.equal(res.status, 400);
    assert.ok((res.data?.fields as Record<string, string>).email);
    const rows = await accounts(env);
    assert.deepEqual(rows.find((r) => r.id === mia.accountId)?.roles, { owner: false, manager: true });
  });
});
