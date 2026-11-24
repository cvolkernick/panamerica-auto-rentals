import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { noteLooksLikePii, parseAgentName } from "../../lib/portal/team";
import { call, devEnv, PANAMERICA, requireDb } from "./support";

const TOKEN = "t".repeat(24) + "-team-test-token-0123456789";
const AGENT = "Forge ⚡ test";

function teamEnv(extra: Partial<PortalEnv> = {}): PortalEnv {
  return devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: TOKEN, ...extra });
}

async function team(
  env: PortalEnv,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string | null> = {}
) {
  const h = new Headers();
  const auth = "authorization" in headers ? headers.authorization : `Bearer ${TOKEN}`;
  if (auth) h.set("authorization", auth);
  const agent = "x-agent-name" in headers ? headers["x-agent-name"] : encodeURIComponent(AGENT);
  if (agent) h.set("x-agent-name", agent);
  if (body !== undefined) h.set("content-type", "application/json");
  const response = await handlePortal(
    new Request(`http://127.0.0.1/api/portal/team${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : null, text };
}

async function seedCar(env: PortalEnv, overrides: Record<string, unknown> = {}): Promise<number> {
  const created = await call(env, "POST", "/api/portal/admin/cars", {
    ownerId: 1,
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    color: "Silver",
    licensePlate: "TEAM-001",
    vin: "1TEAMCAR000000001",
    ...overrides,
  });
  assert.equal(created.status, 201, created.text);
  return (created.data?.car as { id: number }).id;
}

const expense = {
  entryDate: "2026-11-20",
  category: "maintenance",
  amountCents: 4599,
  note: "Oil change - Jiffy Lube receipt",
};

describe("team connector auth", () => {
  test("disabled (404) when PORTAL_TEAM_TOKEN is unset or short", async () => {
    const env = devEnv(PANAMERICA);
    assert.equal((await team(env, "GET", "/cars")).status, 404);
    const short = devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: "short" });
    assert.equal((await team(short, "GET", "/cars", undefined, { authorization: "Bearer short" })).status, 404);
  });

  test("wrong or missing token is 401 and never echoes the token", async () => {
    const env = teamEnv();
    const missing = await team(env, "GET", "/cars", undefined, { authorization: null });
    assert.equal(missing.status, 401);
    const wrong = await team(env, "GET", "/cars", undefined, { authorization: `Bearer ${TOKEN}x` });
    assert.equal(wrong.status, 401);
    assert.ok(!wrong.text.includes(TOKEN));
  });

  test("agent name is required", async () => {
    const env = teamEnv();
    const res = await team(env, "GET", "/cars", undefined, { "x-agent-name": null });
    assert.equal(res.status, 400);
    assert.equal(res.data?.error, "agent_name_required");
    assert.equal(parseAgentName("%E2%9A%A1 Grok"), "⚡ Grok");
    assert.equal(parseAgentName("a".repeat(81)), null);
    assert.equal(parseAgentName("bad%0Aname"), null);
  });

  test("dev cookie auth does not open team routes, and the token does not open admin routes", async () => {
    const env = teamEnv();
    const viaSession = await call(env, "GET", "/api/portal/team/cars");
    assert.equal(viaSession.status, 401);
    const response = await handlePortal(
      new Request("http://127.0.0.1/api/portal/admin/cars", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      { ...env, PORTAL_DEV_AUTH: undefined }
    );
    assert.equal(response.status, 401);
  });
});

describe("team connector cars", () => {
  test("lists and reads cars without owner email", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    const list = await team(env, "GET", "/cars");
    assert.equal(list.status, 200);
    const cars = list.data?.cars as Record<string, unknown>[];
    assert.equal(cars.length, 1);
    assert.equal(cars[0].ownerEmail, undefined);
    assert.ok(!list.text.includes("@"));
    const one = await team(env, "GET", `/cars/${carId}`);
    assert.equal((one.data?.car as { model: string }).model, "Corolla");
    assert.equal((await team(env, "GET", "/cars/999")).status, 404);
  });

  test("edits details with a logged write; no owner moves, no deletes", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    const edited = await team(env, "PATCH", `/cars/${carId}`, { color: "Blue" });
    assert.equal(edited.status, 200, edited.text);
    assert.equal((edited.data?.car as { color: string }).color, "Blue");
    const moved = await team(env, "PATCH", `/cars/${carId}`, { ownerId: 2 });
    assert.equal(moved.status, 400);
    assert.equal((await team(env, "DELETE", `/cars/${carId}`)).status, 405);
    assert.equal((await team(env, "POST", "/cars", {})).status, 405);
    const log = await team(env, "GET", `/write-log?carId=${carId}`);
    const entries = log.data?.entries as Record<string, unknown>[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "car.update");
    assert.equal(entries[0].agentName, AGENT);
    assert.equal((entries[0].before as { color: string }).color, "Silver");
    assert.equal((entries[0].after as { color: string }).color, "Blue");
  });
});

describe("team connector expenses", () => {
  test("add, edit, delete own entry; each write logged with the agent name", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    const created = await team(env, "POST", `/cars/${carId}/expenses`, expense);
    assert.equal(created.status, 201, created.text);
    const id = (created.data?.expense as { id: number }).id;
    assert.equal(typeof created.data?.writeLogId, "number");

    const admin = await call(env, "GET", `/api/portal/admin/cars/${carId}/expenses`);
    assert.equal((admin.data?.expenses as unknown[]).length, 1);

    const edited = await team(env, "PATCH", `/cars/${carId}/expenses/${id}`, { amountCents: 4800 });
    assert.equal(edited.status, 200);
    assert.equal((edited.data?.expense as { amountCents: number }).amountCents, 4800);

    const removed = await team(env, "DELETE", `/cars/${carId}/expenses/${id}`);
    assert.equal(removed.status, 200);
    const log = await team(env, "GET", `/write-log?carId=${carId}`);
    const actions = (log.data?.entries as { action: string; agentName: string }[]).map((e) => e.action);
    assert.deepEqual(actions, ["expense.delete", "expense.update", "expense.create"]);
    assert.ok((log.data?.entries as { agentName: string }[]).every((e) => e.agentName === AGENT));
  });

  test("cannot delete an expense an admin entered", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    const adminMade = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, expense);
    const id = (adminMade.data?.expense as { id: number }).id;
    const denied = await team(env, "DELETE", `/cars/${carId}/expenses/${id}`);
    assert.equal(denied.status, 403);
    assert.equal(denied.data?.reason, "not_connector_entry");
  });

  test("refuses commission (fee is computed), PII-looking notes, bad amounts", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    assert.equal((await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, category: "commission" })).status, 400);
    assert.equal((await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, note: "guest jane@example.com" })).status, 400);
    assert.equal((await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, note: "call 239-555-0100" })).status, 400);
    assert.equal((await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, amountCents: -5 })).status, 400);
    assert.equal((await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, amountCents: 12.5 })).status, 400);
    assert.equal(noteLooksLikePii("Invoice 20261120 Midas"), false);
  });
});

describe("team connector income and money rules", () => {
  test("manual income flows through the statement fee tiers and carry-forward", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    // 3-day trip: 20% fee on the platform net payout.
    const short = await team(env, "POST", `/cars/${carId}/income`, {
      startDate: "2026-10-01",
      endDate: "2026-10-04",
      payoutCents: 30000,
    });
    assert.equal(short.status, 201, short.text);
    // 10-day trip: 15%.
    await team(env, "POST", `/cars/${carId}/income`, { startDate: "2026-10-10", endDate: "2026-10-20", payoutCents: 100000 });
    // 30-day trip: 10%.
    await team(env, "POST", `/cars/${carId}/income`, { startDate: "2026-10-21", endDate: "2026-11-20", payoutCents: 200000 });
    // Big October expense.
    await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, entryDate: "2026-10-25", amountCents: 400000 });

    const st = await team(env, "GET", `/cars/${carId}/statement?month=2026-10`);
    assert.equal(st.status, 200, st.text);
    const statement = st.data?.statement as {
      incomeCents: number;
      managementFeeCents: number;
      expenseCents: number;
      closingBalanceCents: number;
      payoutDueCents: number;
      trips: { feeRateBps: number }[];
    };
    assert.equal(statement.incomeCents, 330000);
    assert.equal(statement.managementFeeCents, 6000 + 15000 + 20000);
    assert.deepEqual(statement.trips.map((t) => t.feeRateBps), [2000, 1500, 1000]);
    assert.equal(statement.expenseCents, 400000);
    assert.equal(statement.closingBalanceCents, 330000 - 400000 - 41000);
    assert.equal(statement.payoutDueCents, 0);

    // Shortfall carries into November as a negative opening balance.
    const nov = await team(env, "GET", `/cars/${carId}/statement?month=2026-11`);
    const novStatement = nov.data?.statement as { openingBalanceCents: number };
    assert.equal(novStatement.openingBalanceCents, -111000);

    // No payout routes exist on the connector.
    assert.equal((await team(env, "POST", `/cars/${carId}/payouts`, { amountCents: 1 })).status, 404);
  });

  test("manual income edit/delete; imported trips stay read-only", async () => {
    const env = teamEnv();
    const carId = await seedCar(env);
    const created = await team(env, "POST", `/cars/${carId}/income`, {
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      payoutCents: 25000,
      grossCents: 30000,
      platformFeesCents: 5000,
    });
    const income = created.data?.income as { id: number; platform: string; editable: boolean };
    assert.equal(income.platform, "manual");
    assert.equal(income.editable, true);
    const patched = await team(env, "PATCH", `/cars/${carId}/income/${income.id}`, { payoutCents: 26000 });
    assert.equal(patched.status, 200, patched.text);
    assert.equal((patched.data?.income as { payoutCents: number }).payoutCents, 26000);
    assert.equal((await team(env, "PATCH", `/cars/${carId}/income/${income.id}`, { status: "x" })).status, 400);
    assert.equal(
      (await team(env, "POST", `/cars/${carId}/income`, { startDate: "2026-11-05", endDate: "2026-11-01", payoutCents: 1 })).status,
      400
    );

    const db = requireDb(env);
    await db
      .prepare(
        `INSERT INTO trips (car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income, payout_cents)
         VALUES (?, 'turo', 'T-1', '2026-11-02', '2026-11-04', 'completed', 1, 10000)`
      )
      .bind(carId)
      .run();
    const list = await team(env, "GET", `/cars/${carId}/income?month=2026-11`);
    const rows = list.data?.income as { id: number; platform: string; editable: boolean }[];
    assert.equal(rows.length, 2);
    const imported = rows.find((r) => r.platform === "turo");
    assert.ok(imported && !imported.editable);
    assert.equal((await team(env, "PATCH", `/cars/${carId}/income/${imported.id}`, { payoutCents: 1 })).status, 403);
    assert.equal((await team(env, "DELETE", `/cars/${carId}/income/${imported.id}`)).status, 403);

    assert.equal((await team(env, "DELETE", `/cars/${carId}/income/${income.id}`)).status, 200);
    const log = await team(env, "GET", `/write-log?carId=${carId}`);
    assert.deepEqual(
      (log.data?.entries as { action: string }[]).map((e) => e.action),
      ["income.delete", "income.update", "income.create"]
    );
  });
});
