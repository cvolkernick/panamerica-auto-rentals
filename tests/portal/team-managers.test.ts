import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { todayEastern } from "../../lib/portal/ledger";
import { resetTeamRateLimit } from "../../lib/portal/team";
import { call, devEnv, PANAMERICA, requireDb } from "./support";

const TOKEN = "m".repeat(24) + "-team-manager-token-0123456789";
const CLIENT_NAME = "Client Owner Test";
const CLIENT_EMAIL = "client.owner@example.com";
const ADMIN_LIST_NAME = "Listed Admin Test";
const ADMIN_LIST_EMAIL = "listed.admin@example.com";
const CARA_ACCOUNT_EMAIL = "cara.manager@example.com";

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function team(env: PortalEnv, method: string, path: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers = new Headers({ "x-agent-name": "Helm test" });
  if (auth) headers.set("authorization", auth);
  const response = await handlePortal(
    new Request(`http://127.0.0.1/api/portal/team${path}`, { method, headers }),
    env
  );
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : null, text };
}

async function seedOwner(env: PortalEnv, name: string, email: string): Promise<number> {
  const created = await call(env, "POST", "/api/portal/admin/owners", { name, email });
  assert.equal(created.status, 201, created.text);
  return (created.data?.owner as { id: number }).id;
}

async function seedCar(env: PortalEnv, n: number, ownerId: number): Promise<number> {
  const created = await call(env, "POST", "/api/portal/admin/cars", {
    ownerId,
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    color: "Silver",
    licensePlate: `MGR-00${n}`,
    vin: `1MGRCAR${String(n).padStart(10, "0")}`,
  });
  assert.equal(created.status, 201, created.text);
  return (created.data?.car as { id: number }).id;
}

async function seedManager(env: PortalEnv, name: string, accountId: number | null = null): Promise<number> {
  const db = requireDb(env);
  await db
    .prepare(`INSERT INTO managers (name, created_by, account_id) VALUES (?, 1, ?)`)
    .bind(name, accountId)
    .run();
  const row = await db.prepare(`SELECT id FROM managers WHERE name = ?`).bind(name).first<{ id: number }>();
  return Number(row?.id);
}

async function assign(env: PortalEnv, carId: number, managerId: number, start: string, end: string | null = null) {
  await requireDb(env)
    .prepare(
      `INSERT INTO car_manager_assignments (car_id, manager_id, start_date, end_date, created_by) VALUES (?, ?, ?, ?, 1)`
    )
    .bind(carId, managerId, start, end)
    .run();
}

type Item = {
  car_id: number;
  manager: { id: number; name: string; since: string; contact_ref: string; has_portal_account: boolean } | null;
  owner_type: string;
};

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, out));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysOf(inner, out);
    }
  }
  return out;
}

beforeEach(() => resetTeamRateLimit());

describe("team connector car-to-manager lookup", async () => {
  const today = todayEastern();

  async function fleet() {
    const env = devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: TOKEN, ADMIN_EMAILS: ADMIN_LIST_EMAIL });
    const clientId = await seedOwner(env, CLIENT_NAME, CLIENT_EMAIL);
    const listedAdminId = await seedOwner(env, ADMIN_LIST_NAME, ADMIN_LIST_EMAIL);
    const caraAccount = await seedOwner(env, "Cara Manager Account", CARA_ACCOUNT_EMAIL);
    const cars = {
      startsToday: await seedCar(env, 1, 1),
      endedToday: await seedCar(env, 2, 1),
      futureStart: await seedCar(env, 3, 1),
      reassigned: await seedCar(env, 4, clientId),
      unassigned: await seedCar(env, 5, clientId),
      listedAdmin: await seedCar(env, 6, listedAdminId),
    };
    const ana = await seedManager(env, "Ana Test");
    const ben = await seedManager(env, "Ben Test");
    const cara = await seedManager(env, "Cara Test", caraAccount);
    await assign(env, cars.startsToday, ana, today);
    await assign(env, cars.endedToday, ben, addDays(today, -10), today);
    await assign(env, cars.futureStart, ana, addDays(today, 1));
    await assign(env, cars.reassigned, ben, addDays(today, -30), addDays(today, -5));
    await assign(env, cars.reassigned, cara, addDays(today, -5));
    return { env, cars, ana, ben, cara };
  }

  test("assignment date edges, reassignment history, unassigned cars and owner_type", async () => {
    const { env, cars, ana, cara } = await fleet();

    const startsToday = await team(env, "GET", `/cars/${cars.startsToday}/manager`);
    assert.equal(startsToday.status, 200, startsToday.text);
    assert.deepEqual(startsToday.data, {
      as_of: today,
      car_id: cars.startsToday,
      manager: { id: ana, name: "Ana Test", since: today, contact_ref: `manager:${ana}`, has_portal_account: false },
      owner_type: "company",
    });

    // end_date is exclusive: an assignment that ends today no longer covers today.
    const ended = await team(env, "GET", `/cars/${cars.endedToday}/manager`);
    assert.equal(ended.status, 200);
    assert.equal(ended.data?.manager, null);

    // A future start does not cover today yet.
    const future = await team(env, "GET", `/cars/${cars.futureStart}/manager`);
    assert.equal(future.data?.manager, null);

    // History: the closed Ben row is ignored, the current Cara row wins.
    const reassigned = await team(env, "GET", `/cars/${cars.reassigned}/manager`);
    assert.deepEqual(reassigned.data?.manager, {
      id: cara,
      name: "Cara Test",
      since: addDays(today, -5),
      contact_ref: `manager:${cara}`,
      has_portal_account: true,
    });
    assert.equal(reassigned.data?.owner_type, "client");

    const unassigned = await team(env, "GET", `/cars/${cars.unassigned}/manager`);
    assert.deepEqual(unassigned.data, { as_of: today, car_id: cars.unassigned, manager: null, owner_type: "client" });

    // An owner listed in ADMIN_EMAILS counts as company, like effectiveAdmin().
    const listed = await team(env, "GET", `/cars/${cars.listedAdmin}/manager`);
    assert.equal(listed.data?.owner_type, "company");
  });

  test("the list returns one item per car, in car order, matching the single-car reads", async () => {
    const { env, cars } = await fleet();
    const list = await team(env, "GET", "/managers/assignments");
    assert.equal(list.status, 200, list.text);
    assert.equal(list.data?.as_of, today);
    const items = list.data?.assignments as Item[];
    assert.deepEqual(
      items.map((item) => item.car_id),
      Object.values(cars).sort((a, b) => a - b)
    );
    for (const item of items) {
      const one = await team(env, "GET", `/cars/${item.car_id}/manager`);
      assert.deepEqual({ ...one.data, as_of: undefined }, { ...item, as_of: undefined });
    }
    const managed = items.filter((item) => item.manager).map((item) => item.manager?.name);
    assert.deepEqual(managed, ["Ana Test", "Cara Test"]);
  });

  test("no owner names, emails or phone numbers anywhere in the responses", async () => {
    const { env, cars } = await fleet();
    const bodies = [
      await team(env, "GET", "/managers/assignments"),
      ...(await Promise.all(Object.values(cars).map((id) => team(env, "GET", `/cars/${id}/manager`)))),
    ];
    for (const body of bodies) {
      assert.equal(body.status, 200);
      const keys = keysOf(body.data).map((key) => key.toLowerCase());
      assert.equal(keys.some((key) => key.includes("phone") || key.includes("email")), false, body.text);
      assert.equal(keys.includes("owner_name") || keys.includes("ownername") || keys.includes("owner"), false);
      for (const secret of [
        CLIENT_NAME,
        CLIENT_EMAIL,
        ADMIN_LIST_NAME,
        ADMIN_LIST_EMAIL,
        CARA_ACCOUNT_EMAIL,
        "Cara Manager Account",
        "Panamerica Auto Rentals",
        PANAMERICA,
      ]) {
        assert.equal(body.text.includes(secret), false, `${secret} leaked`);
      }
      assert.equal(body.text.includes("@"), false);
      assert.doesNotMatch(body.text, /\d{3}[\s.-]\d{3}[\s.-]\d{4}/);
    }
  });

  test("bad or missing token is 401, unknown car is 404, writes are refused, nothing is logged", async () => {
    const { env, cars } = await fleet();
    assert.equal((await team(env, "GET", "/managers/assignments", null)).status, 401);
    assert.equal((await team(env, "GET", `/cars/${cars.startsToday}/manager`, null)).status, 401);
    assert.equal((await team(env, "GET", `/cars/${cars.startsToday}/manager`, `Bearer ${TOKEN}x`)).status, 401);
    const wrong = await team(env, "GET", "/managers/assignments", "Bearer not-the-token-not-the-token-xx");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.text.includes(TOKEN), false);

    const unknown = await team(env, "GET", "/cars/9999/manager");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.data, { error: "car_not_found" });

    for (const method of ["POST", "PATCH", "DELETE"]) {
      assert.equal((await team(env, method, `/cars/${cars.startsToday}/manager`)).status, 405);
      assert.equal((await team(env, method, "/managers/assignments")).status, 405);
    }

    const log = await requireDb(env).prepare(`SELECT COUNT(*) AS n FROM team_write_log`).first<{ n: number }>();
    assert.equal(Number(log?.n), 0);
  });

  test("cookie sessions do not reach the team lookup", async () => {
    const { env } = await fleet();
    // Dev auth is on for this env, but the team routes ignore sessions and need the token.
    const session = await call(env, "GET", "/api/portal/team/managers/assignments");
    assert.equal(session.status, 401);
  });
});
