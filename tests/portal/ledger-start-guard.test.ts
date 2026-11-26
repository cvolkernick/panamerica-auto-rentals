import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { resetTeamRateLimit } from "../../lib/portal/team";
import { call, devEnv, PANAMERICA, requireDb, startLedgerEarly } from "./support";

// Synthetic data only. Default ledger start is 2026-11-01.

const TOKEN = "g".repeat(24) + "-guard-test-token-0123456789";
const BEFORE = "This date is before this car's ledger start (2026-11-01).";

function teamEnv(): PortalEnv {
  return devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: TOKEN });
}

async function team(env: PortalEnv, method: string, path: string, body?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}`, "x-agent-name": "guard-test" });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handlePortal(
    new Request(`http://127.0.0.1/api/portal/team${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : null, text };
}

async function addCar(env: PortalEnv): Promise<number> {
  const created = await call(env, "POST", "/api/portal/admin/cars", {
    ownerId: 1,
    year: 2024,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: "GRD001",
    vin: "1TSTGRDX000000001",
  });
  assert.equal(created.status, 201, created.text);
  return (created.data?.car as { id: number }).id;
}

const expense = { category: "cleaning", amountCents: 1500, note: "Wash" };

beforeEach(() => resetTeamRateLimit());

describe("writes before the ledger start are rejected", () => {
  test("admin expense create and edit", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    const early = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, { ...expense, entryDate: "2026-10-31" });
    assert.equal(early.status, 400);
    assert.deepEqual(early.data?.fields, { entryDate: BEFORE });
    const onStart = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, { ...expense, entryDate: "2026-11-01" });
    assert.equal(onStart.status, 201, onStart.text);
    const id = (onStart.data?.expense as { id: number }).id;
    const moved = await call(env, "PATCH", `/api/portal/admin/cars/${carId}/expenses/${id}`, { entryDate: "2026-10-15" });
    assert.equal(moved.status, 400);
    assert.deepEqual(moved.data?.fields, { entryDate: BEFORE });
    const ok = await call(env, "PATCH", `/api/portal/admin/cars/${carId}/expenses/${id}`, { amountCents: 1600 });
    assert.equal(ok.status, 200, ok.text);
    const count = await requireDb(env)
      .prepare(`SELECT COUNT(*) AS n FROM expenses WHERE car_id = ?`)
      .bind(carId)
      .first<{ n: number }>();
    assert.equal(Number(count?.n), 1);
  });

  test("admin payout create: period month and paid date", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    const early = await call(env, "POST", `/api/portal/admin/cars/${carId}/payouts`, {
      periodMonth: "2026-10",
      paidDate: "2026-10-30",
      amountCents: 500,
    });
    assert.equal(early.status, 400);
    assert.deepEqual(early.data?.fields, { periodMonth: BEFORE, paidDate: BEFORE });
    const ok = await call(env, "POST", `/api/portal/admin/cars/${carId}/payouts`, {
      periodMonth: "2026-11",
      paidDate: "2026-11-02",
      amountCents: 500,
    });
    assert.equal(ok.status, 201, ok.text);
  });

  test("team expense create and edit", async () => {
    const env = teamEnv();
    const carId = await addCar(env);
    const early = await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, entryDate: "2026-09-30" });
    assert.equal(early.status, 400, early.text);
    assert.deepEqual(early.data?.fields, { entryDate: BEFORE });
    const ok = await team(env, "POST", `/cars/${carId}/expenses`, { ...expense, entryDate: "2026-11-01" });
    assert.equal(ok.status, 201, ok.text);
    const id = (ok.data?.expense as { id: number }).id;
    const moved = await team(env, "PATCH", `/cars/${carId}/expenses/${id}`, { entryDate: "2026-10-31" });
    assert.equal(moved.status, 400, moved.text);
    assert.deepEqual(moved.data?.fields, { entryDate: BEFORE });
  });

  test("the guard follows a per-car start", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    await startLedgerEarly(env, carId, "2026-12-01");
    const early = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, { ...expense, entryDate: "2026-11-20" });
    assert.equal(early.status, 400);
    assert.deepEqual(early.data?.fields, { entryDate: "This date is before this car's ledger start (2026-12-01)." });
  });
});

describe("payout log", () => {
  test("lists only payouts on or after the car's start month", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    // A pre-start payout already on file (written before the guard existed).
    await requireDb(env)
      .prepare(
        `INSERT INTO payouts (car_id, period_month, paid_date, amount_cents, note, created_by)
         VALUES (?, '2026-10', '2026-10-30', 700, NULL, 1)`
      )
      .bind(carId)
      .run();
    const ok = await call(env, "POST", `/api/portal/admin/cars/${carId}/payouts`, {
      periodMonth: "2026-11",
      paidDate: "2026-11-03",
      amountCents: 900,
    });
    assert.equal(ok.status, 201, ok.text);
    const admin = await call(env, "GET", `/api/portal/admin/cars/${carId}/payouts`);
    assert.deepEqual((admin.data?.payouts as { periodMonth: string }[]).map((row) => row.periodMonth), ["2026-11"]);
    const owner = await call(env, "GET", `/api/portal/cars/${carId}/payouts`);
    assert.deepEqual((owner.data?.payouts as { periodMonth: string }[]).map((row) => row.periodMonth), ["2026-11"]);
    // Kept, never deleted.
    const stored = await requireDb(env)
      .prepare(`SELECT COUNT(*) AS n FROM payouts WHERE car_id = ?`)
      .bind(carId)
      .first<{ n: number }>();
    assert.equal(Number(stored?.n), 2);
  });
});
