import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assignmentCovers,
  bpsToPercentLabel,
  buildManagerAccrual,
  managerShareCents,
  parseAssignment,
  parseManagerCreate,
  percentToBps,
  planAssignment,
} from "../../lib/portal/managers";
import type { StatementTripInput } from "../../lib/portal/statement";
import type { PortalEnv } from "../../lib/portal/env";
import { call, DEALER, devEnv, PANAMERICA, requireDb } from "./support";

function trip(overrides: Partial<StatementTripInput> & { id: number; startDate: string }): StatementTripInput {
  return {
    platform: "turo",
    externalTripId: `T${overrides.id}`,
    endDate: overrides.startDate,
    status: "Completed",
    countsAsIncome: true,
    incomeCents: 0,
    hasPending: false,
    pendingPayoutCents: null,
    ...overrides,
  };
}

async function seedCar(env: PortalEnv, plate: string, vin: string): Promise<number> {
  const result = await requireDb(env)
    .prepare(
      `INSERT INTO cars (owner_id, year, make, model, color, license_plate, vin) VALUES (1, 2022, 'Toyota', 'Corolla', 'White', ?, ?)`
    )
    .bind(plate, vin)
    .run();
  return Number(result.meta.last_row_id);
}

async function seedTrip(
  env: PortalEnv,
  carId: number,
  id: string,
  startDate: string,
  endDate: string,
  payoutCents: number,
  countsAsIncome = 1
) {
  await requireDb(env)
    .prepare(
      `INSERT INTO trips (car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income, payout_cents)
       VALUES (?, 'turo', ?, ?, ?, 'Completed', ?, ?)`
    )
    .bind(carId, id, startDate, endDate, countsAsIncome, payoutCents)
    .run();
}

describe("manager share math", () => {
  test("share rounds half up per trip, zero for zero fee or zero share", () => {
    assert.equal(managerShareCents(2000, 1000), 200);
    assert.equal(managerShareCents(2005, 1000), 201); // 200.5 -> 201
    assert.equal(managerShareCents(2004, 1000), 200);
    assert.equal(managerShareCents(0, 1000), 0);
    assert.equal(managerShareCents(2000, 0), 0);
    assert.equal(managerShareCents(2000, 10000), 2000);
  });

  test("percent input converts to basis points and back", () => {
    assert.equal(percentToBps("12.5"), 1250);
    assert.equal(percentToBps("12.50%"), 1250);
    assert.equal(percentToBps("0"), 0);
    assert.equal(percentToBps("100"), 10000);
    assert.equal(percentToBps("100.01"), null);
    assert.equal(percentToBps("1.234"), null);
    assert.equal(percentToBps("abc"), null);
    assert.equal(bpsToPercentLabel(1250), "12.5%");
    assert.equal(bpsToPercentLabel(1000), "10%");
    assert.equal(bpsToPercentLabel(1205), "12.05%");
  });

  test("assignment covers start inclusive, end exclusive", () => {
    const a = { start_date: "2026-11-01", end_date: "2026-11-15" };
    assert.equal(assignmentCovers(a, "2026-10-31"), false);
    assert.equal(assignmentCovers(a, "2026-11-01"), true);
    assert.equal(assignmentCovers(a, "2026-11-14"), true);
    assert.equal(assignmentCovers(a, "2026-11-15"), false);
    assert.equal(assignmentCovers({ start_date: "2026-11-01", end_date: null }, "2030-01-01"), true);
  });

  test("accrual uses the tier fee on counted income, per trip, inside the assignment window", () => {
    const accrual = buildManagerAccrual({
      shareBps: 2500,
      assignments: [{ id: 1, car_id: 7, start_date: "2026-11-01", end_date: "2026-12-01" }],
      tripsByCar: new Map([
        [
          7,
          [
            // 3 days, 20% of $500 = $100 fee, 25% share = $25
            trip({ id: 1, startDate: "2026-11-02", endDate: "2026-11-05", incomeCents: 50000 }),
            // 10 days, 15% of $1,000 = $150 fee, share $37.50
            trip({ id: 2, startDate: "2026-11-10", endDate: "2026-11-20", incomeCents: 100000 }),
            // 30 days, 10% of $2,000 = $200 fee, share $50
            trip({ id: 3, startDate: "2026-11-25", endDate: "2026-12-25", incomeCents: 200000 }),
            // before the assignment: not this manager's
            trip({ id: 4, startDate: "2026-10-30", endDate: "2026-11-02", incomeCents: 50000 }),
            // starts on the end date (exclusive): next manager's
            trip({ id: 5, startDate: "2026-12-01", endDate: "2026-12-03", incomeCents: 50000 }),
            // does not count as income: no fee, no share
            trip({ id: 6, startDate: "2026-11-12", endDate: "2026-11-13", incomeCents: 50000, countsAsIncome: false }),
          ],
        ],
      ]),
    });
    assert.deepEqual(
      accrual.trips.map((t) => [t.tripId, t.feeRateBps, t.feeCents, t.shareCents]),
      [
        [1, 2000, 10000, 2500],
        [2, 1500, 15000, 3750],
        [3, 1000, 20000, 5000],
      ]
    );
    assert.equal(accrual.feeCents, 45000);
    assert.equal(accrual.accruedCents, 11250);
    assert.deepEqual(accrual.months, [{ month: "2026-11", tripCount: 3, feeCents: 45000, shareCents: 11250 }]);
    assert.deepEqual(accrual.cars, [{ carId: 7, tripCount: 3, feeCents: 45000, shareCents: 11250 }]);
  });
});

describe("assignment rules", () => {
  test("validation", () => {
    assert.equal(parseAssignment({ managerId: 1, startDate: "2026-11-01" }).ok, true);
    assert.equal(parseAssignment({ managerId: null, startDate: "2026-11-01" }).ok, true);
    assert.equal(parseAssignment({ managerId: 0, startDate: "2026-11-01" }).ok, false);
    assert.equal(parseAssignment({ managerId: 1, startDate: "2026-02-30" }).ok, false);
    assert.equal(parseManagerCreate({ name: "Ana", shareBps: 1000 }).ok, true);
    assert.equal(parseManagerCreate({ name: "Ana", shareBps: 10001 }).ok, false);
    assert.equal(parseManagerCreate({ name: "ana@example.com", shareBps: 1000 }).ok, false);
    assert.equal(parseManagerCreate({ name: "Ana 239-555-0101", shareBps: 1000 }).ok, false);
  });

  test("reassign closes the open row and opens a new one on the same date", () => {
    const plan = planAssignment([{ id: 4, manager_id: 1, start_date: "2026-11-01", end_date: null }], {
      managerId: 2,
      startDate: "2026-11-15",
    });
    assert.deepEqual(plan, {
      ok: true,
      close: { id: 4, endDate: "2026-11-15" },
      open: { managerId: 2, startDate: "2026-11-15" },
    });
  });

  test("cannot backdate before the current start, reassign to the same manager, or overlap history", () => {
    const open = [{ id: 4, manager_id: 1, start_date: "2026-11-01", end_date: null }];
    assert.equal(planAssignment(open, { managerId: 2, startDate: "2026-11-01" }).ok, false);
    assert.equal(planAssignment(open, { managerId: 1, startDate: "2026-11-20" }).ok, false);
    const closed = [{ id: 4, manager_id: 1, start_date: "2026-11-01", end_date: "2026-11-15" }];
    assert.equal(planAssignment(closed, { managerId: 2, startDate: "2026-11-14" }).ok, false);
    assert.equal(planAssignment(closed, { managerId: 2, startDate: "2026-11-15" }).ok, true);
    assert.equal(planAssignment(closed, { managerId: null, startDate: "2026-11-20" }).ok, false);
  });
});

describe("manager admin routes", () => {
  test("non-admins get 403 on every manager route", async () => {
    const env = devEnv(PANAMERICA);
    await requireDb(env)
      .prepare(`INSERT INTO owners (name, email, is_admin) VALUES ('Dealer', ?, 0)`)
      .bind(DEALER)
      .run();
    const dealer = { ...env, PORTAL_DEV_EMAIL: DEALER };
    for (const [method, path] of [
      ["GET", "/api/portal/admin/managers"],
      ["POST", "/api/portal/admin/managers"],
      ["GET", "/api/portal/admin/managers/1"],
      ["GET", "/api/portal/admin/cars/1/managers"],
      ["POST", "/api/portal/admin/cars/1/managers"],
      ["POST", "/api/portal/admin/cars/1/managers/undo"],
    ]) {
      const result = await call(dealer, method, path, method === "POST" ? {} : undefined);
      assert.equal(result.status, 403, `${method} ${path}`);
    }
  });

  test("end to end: create, assign, reassign, accrue to whoever managed the car, undo", async () => {
    const env = devEnv(PANAMERICA);
    const carA = await seedCar(env, "TEST001", "1HGCM82633A004352");
    const carB = await seedCar(env, "TEST002", "2HGCM82633A004353");

    const ana = await call(env, "POST", "/api/portal/admin/managers", { name: "Ana Test", shareBps: 2500 });
    assert.equal(ana.status, 201);
    const anaId = (ana.data?.manager as { id: number }).id;
    const ben = await call(env, "POST", "/api/portal/admin/managers", { name: "Ben Test", shareBps: 1000 });
    const benId = (ben.data?.manager as { id: number }).id;
    const dup = await call(env, "POST", "/api/portal/admin/managers", { name: "ana test", shareBps: 1 });
    assert.equal(dup.status, 409);

    // Ana gets both cars from Nov 1.
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${carA}/managers`, { managerId: anaId, startDate: "2026-11-01" })).status, 201);
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${carB}/managers`, { managerId: anaId, startDate: "2026-11-01" })).status, 201);
    // Car A moves to Ben on Nov 15.
    const moved = await call(env, "POST", `/api/portal/admin/cars/${carA}/managers`, { managerId: benId, startDate: "2026-11-15" });
    assert.equal(moved.status, 201);
    const history = moved.data?.history as { managerId: number; startDate: string; endDate: string | null }[];
    assert.deepEqual(
      history.map((row) => [row.managerId, row.startDate, row.endDate]),
      [
        [benId, "2026-11-15", null],
        [anaId, "2026-11-01", "2026-11-15"],
      ]
    );

    // Car A: $500 3-day trip Nov 5 (Ana), $500 3-day trip Nov 20 (Ben). Car B: $1,000 10-day trip Nov 10 (Ana).
    await seedTrip(env, carA, "A1", "2026-11-05", "2026-11-08", 50000);
    await seedTrip(env, carA, "A2", "2026-11-20", "2026-11-23", 50000);
    await seedTrip(env, carB, "B1", "2026-11-10", "2026-11-20", 100000);
    await seedTrip(env, carB, "B2", "2026-10-20", "2026-10-22", 100000); // before Ana: nobody's

    const anaDetail = await call(env, "GET", `/api/portal/admin/managers/${anaId}`);
    const anaAccrual = anaDetail.data?.accrual as { accruedCents: number; feeCents: number; tripCount: number };
    // A1 fee $100 x 25% = $25; B1 fee $150 x 25% = $37.50.
    assert.equal(anaAccrual.tripCount, 2);
    assert.equal(anaAccrual.feeCents, 25000);
    assert.equal(anaAccrual.accruedCents, 6250);
    const benDetail = await call(env, "GET", `/api/portal/admin/managers/${benId}`);
    // A2 fee $100 x 10% = $10.
    assert.equal((benDetail.data?.accrual as { accruedCents: number }).accruedCents, 1000);

    const list = await call(env, "GET", "/api/portal/admin/managers");
    const rows = list.data?.managers as { id: number; accruedCents: number; currentCars: { carId: number }[] }[];
    assert.deepEqual(
      rows.map((row) => [row.id, row.accruedCents, row.currentCars.map((c) => c.carId)]),
      [
        [anaId, 6250, [carB]],
        [benId, 1000, [carA]],
      ]
    );

    // Owner statement is untouched by manager math: same fee, no new expense lines.
    const statement = await call(env, "GET", `/api/portal/admin/cars/${carA}/statement?month=2026-11`);
    assert.equal(statement.status, 200);
    const nov = statement.data?.statement as { managementFeeCents: number; expenseCents: number };
    assert.equal(nov.managementFeeCents, 20000);
    assert.equal(nov.expenseCents, 0);

    // Undo the reassignment: Ana has car A again, open-ended.
    const undo = await call(env, "POST", `/api/portal/admin/cars/${carA}/managers/undo`);
    assert.equal(undo.status, 200);
    assert.deepEqual(
      (undo.data?.history as { managerId: number; endDate: string | null }[]).map((r) => [r.managerId, r.endDate]),
      [[anaId, null]]
    );

    // Unassign car B on Dec 1, then undo the unassign.
    const off = await call(env, "POST", `/api/portal/admin/cars/${carB}/managers`, { managerId: null, startDate: "2026-12-01" });
    assert.equal(off.status, 200);
    assert.equal(off.data?.current, null);
    const back = await call(env, "POST", `/api/portal/admin/cars/${carB}/managers/undo`);
    assert.equal((back.data?.current as { managerId: number }).managerId, anaId);

    // Changing the share re-figures the accrual.
    const patched = await call(env, "PATCH", `/api/portal/admin/managers/${benId}`, { shareBps: 5000 });
    assert.equal(patched.status, 200);
    assert.equal((patched.data?.manager as { shareBps: number }).shareBps, 5000);
  });

  test("bad input and missing records", async () => {
    const env = devEnv(PANAMERICA);
    const car = await seedCar(env, "TEST003", "3HGCM82633A004354");
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: 99, startDate: "2026-11-01" })).status, 400);
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/999/managers`, { managerId: 1, startDate: "2026-11-01" })).status, 404);
    assert.equal((await call(env, "GET", `/api/portal/admin/managers/999`)).status, 404);
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${car}/managers/undo`)).status, 409);
    assert.equal((await call(env, "DELETE", `/api/portal/admin/managers/1`)).status, 404);
  });
});
