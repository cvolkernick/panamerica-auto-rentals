import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assignmentCovers,
  bpsToPercentLabel,
  buildManagerAccrual,
  managerShareCents,
  parseAssignment,
  parseManagerCreate,
  parseManagerPatch,
  parseRateCreate,
  percentToBps,
  planAssignment,
  rateOn,
  rateWriteError,
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
      rates: [{ share_bps: 2500, effective_from: "2026-01-01" }],
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

  test("mid-month rate change: trips before keep the old rate, trips on or after use the new one", () => {
    const rates = [
      { share_bps: 1000, effective_from: "2026-11-01" },
      { share_bps: 2000, effective_from: "2026-11-15" },
    ];
    assert.equal(rateOn(rates, "2026-11-14"), 1000);
    assert.equal(rateOn(rates, "2026-11-15"), 2000);
    assert.equal(rateOn(rates, "2026-10-31"), null);
    const accrual = buildManagerAccrual({
      rates,
      assignments: [{ id: 1, car_id: 7, start_date: "2026-11-01", end_date: null }],
      tripsByCar: new Map([
        [
          7,
          [
            // $100 fee each (3-day trips on $500)
            trip({ id: 1, startDate: "2026-11-10", endDate: "2026-11-13", incomeCents: 50000 }),
            // starts the day before the change, ends after it: still the old rate (start-date rule)
            trip({ id: 2, startDate: "2026-11-14", endDate: "2026-11-17", incomeCents: 50000 }),
            trip({ id: 3, startDate: "2026-11-15", endDate: "2026-11-18", incomeCents: 50000 }),
            trip({ id: 4, startDate: "2026-11-25", endDate: "2026-11-28", incomeCents: 50000 }),
          ],
        ],
      ]),
    });
    assert.deepEqual(
      accrual.trips.map((t) => [t.tripId, t.shareBps, t.shareCents]),
      [
        [1, 1000, 1000],
        [2, 1000, 1000],
        [3, 2000, 2000],
        [4, 2000, 2000],
      ]
    );
    assert.equal(accrual.accruedCents, 6000);
    assert.deepEqual(accrual.months, [{ month: "2026-11", tripCount: 4, feeCents: 40000, shareCents: 6000 }]);
  });

  test("rates are append-only: backdating and duplicate dates are refused", () => {
    const rates = [{ effective_from: "2026-11-01" }, { effective_from: "2026-11-15" }];
    assert.ok(rateWriteError(rates, { shareBps: 1, effectiveFrom: "2026-11-10" })?.effectiveFrom);
    assert.match(rateWriteError(rates, { shareBps: 1, effectiveFrom: "2026-11-15" })?.effectiveFrom ?? "", /already starts/);
    assert.equal(rateWriteError(rates, { shareBps: 1, effectiveFrom: "2026-11-16" }), null);
    assert.equal(rateWriteError([], { shareBps: 1, effectiveFrom: "2020-01-01" }), null);
  });
});

describe("assignment rules", () => {
  test("validation", () => {
    assert.equal(parseAssignment({ managerId: 1, startDate: "2026-11-01" }).ok, true);
    assert.equal(parseAssignment({ managerId: null, startDate: "2026-11-01" }).ok, true);
    assert.equal(parseAssignment({ managerId: 0, startDate: "2026-11-01" }).ok, false);
    assert.equal(parseAssignment({ managerId: 1, startDate: "2026-02-30" }).ok, false);
    const d = "2026-11-01";
    assert.equal(parseManagerCreate({ name: "Ana", shareBps: 1000, effectiveFrom: d }).ok, true);
    assert.equal(parseManagerCreate({ name: "Ana", shareBps: 1000 }).ok, false);
    assert.equal(parseManagerCreate({ name: "Ana", shareBps: 10001, effectiveFrom: d }).ok, false);
    assert.equal(parseManagerCreate({ name: "ana@example.com", shareBps: 1000, effectiveFrom: d }).ok, false);
    assert.equal(parseManagerCreate({ name: "Ana 239-555-0101", shareBps: 1000, effectiveFrom: d }).ok, false);
    assert.equal(parseManagerPatch({ shareBps: 1000 }).ok, false);
    assert.equal(parseManagerPatch({ name: "Ana B" }).ok, true);
    assert.equal(parseRateCreate({ shareBps: 1500, effectiveFrom: "2026-11-31" }).ok, false);
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
      ["GET", "/api/portal/admin/managers/1/rates"],
      ["POST", "/api/portal/admin/managers/1/rates"],
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

    const ana = await call(env, "POST", "/api/portal/admin/managers", { name: "Ana Test", shareBps: 2500, effectiveFrom: "2026-11-01" });
    assert.equal(ana.status, 201);
    const anaId = (ana.data?.manager as { id: number }).id;
    const ben = await call(env, "POST", "/api/portal/admin/managers", { name: "Ben Test", shareBps: 1000, effectiveFrom: "2026-11-01" });
    const benId = (ben.data?.manager as { id: number }).id;
    const dup = await call(env, "POST", "/api/portal/admin/managers", { name: "ana test", shareBps: 1, effectiveFrom: "2026-11-01" });
    assert.equal(dup.status, 409);

    // A manager can't have a car before their first share rate starts.
    const early = await call(env, "POST", `/api/portal/admin/cars/${carA}/managers`, { managerId: anaId, startDate: "2026-10-31" });
    assert.equal(early.status, 400);
    assert.ok((early.data?.fields as Record<string, string>).startDate);

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

    // Share rate change, forward only. Owner statements before and after must match.
    const stmtBefore = (await call(env, "GET", `/api/portal/admin/cars/${carA}/statement?month=2026-11`)).text;
    const stmtBeforeB = (await call(env, "GET", `/api/portal/admin/cars/${carB}/statement?month=2026-11`)).text;
    // Ana (25%) has car A again after the undo. Add a car A trip on Nov 25 at $500 / 3 days ($100 fee).
    await seedTrip(env, carA, "A3", "2026-11-25", "2026-11-28", 50000);
    // A1 (Nov 5) and B1 (Nov 10) were earned at 25%. Ana moves to 40% from Nov 20.
    const backdated = await call(env, "POST", `/api/portal/admin/managers/${anaId}/rates`, { shareBps: 4000, effectiveFrom: "2026-10-15" });
    assert.equal(backdated.status, 400);
    const duplicate = await call(env, "POST", `/api/portal/admin/managers/${anaId}/rates`, { shareBps: 4000, effectiveFrom: "2026-11-01" });
    assert.equal(duplicate.status, 400);
    const raised = await call(env, "POST", `/api/portal/admin/managers/${anaId}/rates`, { shareBps: 4000, effectiveFrom: "2026-11-20" });
    assert.equal(raised.status, 201);
    const rates = (raised.data?.manager as { rates: { shareBps: number; effectiveFrom: string }[] }).rates;
    assert.deepEqual(rates.map((r) => [r.effectiveFrom, r.shareBps]), [["2026-11-01", 2500], ["2026-11-20", 4000]]);
    const raisedAccrual = raised.data?.accrual as { accruedCents: number; trips: { tripId: number; startDate: string; shareBps: number; shareCents: number }[] };
    // A1 $100 x 25% = $25, B1 $150 x 25% = $37.50, A2 (Nov 20, Ana again after undo) $100 x 40% = $40, A3 $100 x 40% = $40.
    assert.deepEqual(
      raisedAccrual.trips.map((t) => [t.startDate, t.shareBps, t.shareCents]),
      [["2026-11-05", 2500, 2500], ["2026-11-10", 2500, 3750], ["2026-11-20", 4000, 4000], ["2026-11-25", 4000, 4000]]
    );
    assert.equal(raisedAccrual.accruedCents, 14250);
    // Rate rows are never re-rated in place.
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${benId}`, { shareBps: 5000 })).status, 400);
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${benId}`, { name: "Ben Tester" })).status, 200);
    // Owner statements unchanged by the rate change (car A gained a trip, so compare B exactly and A's fee rule).
    assert.equal((await call(env, "GET", `/api/portal/admin/cars/${carB}/statement?month=2026-11`)).text, stmtBeforeB);
    const afterA = (await call(env, "GET", `/api/portal/admin/cars/${carA}/statement?month=2026-11`)).data?.statement as { managementFeeCents: number; expenseCents: number };
    const beforeA = JSON.parse(stmtBefore).statement as { managementFeeCents: number; expenseCents: number };
    assert.equal(afterA.managementFeeCents, beforeA.managementFeeCents + 10000); // only the new trip's fee
    assert.equal(afterA.expenseCents, beforeA.expenseCents);
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

describe("share rate history and atomic assignment writes", () => {
  test("a later % change leaves earlier trips' accrued share exactly as it was", async () => {
    const env = devEnv(PANAMERICA);
    const car = await seedCar(env, "TEST010", "4HGCM82633A004355");
    const created = await call(env, "POST", "/api/portal/admin/managers", { name: "Cleo Test", shareBps: 1000, effectiveFrom: "2026-10-01" });
    const id = (created.data?.manager as { id: number }).id;
    await call(env, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: id, startDate: "2026-10-01" });
    // Oct 3-day $500 ($100 fee), Nov 10-day $1,000 ($150 fee), both before the change.
    await seedTrip(env, car, "C1", "2026-10-05", "2026-10-08", 50000);
    await seedTrip(env, car, "C2", "2026-11-03", "2026-11-13", 100000);
    type Trip = { tripId: number; startDate: string; shareBps: number; shareCents: number };
    const before = (await call(env, "GET", `/api/portal/admin/managers/${id}`)).data?.accrual as { accruedCents: number; trips: Trip[]; months: unknown[] };
    assert.equal(before.accruedCents, 2500);
    const stmtBefore = (await call(env, "GET", `/api/portal/admin/cars/${car}/statement?month=2026-11`)).text;

    // Raise to 50% from Nov 16, then a trip after the change.
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/${id}/rates`, { shareBps: 5000, effectiveFrom: "2026-11-16" })).status, 201);
    const statementAfterRate = (await call(env, "GET", `/api/portal/admin/cars/${car}/statement?month=2026-11`)).text;
    assert.equal(statementAfterRate, stmtBefore, "owner statement byte-identical after a rate change");
    await seedTrip(env, car, "C3", "2026-11-20", "2026-11-23", 50000);

    const after = (await call(env, "GET", `/api/portal/admin/managers/${id}`)).data?.accrual as { accruedCents: number; trips: Trip[]; months: { month: string; shareCents: number }[] };
    // Earlier trips: identical rate and cents.
    assert.deepEqual(after.trips.slice(0, 2), before.trips);
    assert.deepEqual(after.trips.map((t) => [t.startDate, t.shareBps, t.shareCents]), [
      ["2026-10-05", 1000, 1000],
      ["2026-11-03", 1000, 1500],
      ["2026-11-20", 5000, 5000],
    ]);
    assert.equal(after.months.find((m) => m.month === "2026-10")?.shareCents, 1000);
    assert.equal(after.accruedCents, 7500);

    // Backdating before the latest rate and a duplicate date are both refused; history unchanged.
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/${id}/rates`, { shareBps: 9000, effectiveFrom: "2026-11-01" })).status, 400);
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/${id}/rates`, { shareBps: 9000, effectiveFrom: "2026-11-16" })).status, 400);
    const rates = (await call(env, "GET", `/api/portal/admin/managers/${id}/rates`)).data?.rates as { effectiveFrom: string; shareBps: number }[];
    assert.deepEqual(rates.map((r) => [r.effectiveFrom, r.shareBps]), [["2026-10-01", 1000], ["2026-11-16", 5000]]);
  });

  function failingDb(env: PortalEnv, pattern: RegExp): PortalEnv {
    const base = requireDb(env);
    return {
      ...env,
      DB: {
        batch: base.batch?.bind(base),
        prepare(query: string) {
          const inner = base.prepare(query);
          const fail = pattern.test(query);
          const wrapped = {
            bind(...values: unknown[]) {
              inner.bind(...values);
              return wrapped;
            },
            all: <T>() => inner.all<T>(),
            first: <T>() => inner.first<T>(),
            run: () => (fail ? Promise.reject(new Error("injected failure")) : inner.run()),
          };
          return wrapped;
        },
      },
    };
  }

  async function setupTwo(env: PortalEnv) {
    const car = await seedCar(env, "TEST020", "5HGCM82633A004356");
    const a = (await call(env, "POST", "/api/portal/admin/managers", { name: "Dee Test", shareBps: 1000, effectiveFrom: "2026-10-01" })).data?.manager as { id: number };
    const b = (await call(env, "POST", "/api/portal/admin/managers", { name: "Eli Test", shareBps: 1000, effectiveFrom: "2026-10-01" })).data?.manager as { id: number };
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: a.id, startDate: "2026-11-01" })).status, 201);
    return { car, a: a.id, b: b.id };
  }

  function historyOf(data: Record<string, unknown> | null) {
    return (data?.history as { managerId: number; startDate: string; endDate: string | null }[]).map((r) => [r.managerId, r.startDate, r.endDate]);
  }

  test("reassign: if the new row's insert fails, the close rolls back and the prior manager stays", async () => {
    const env = devEnv(PANAMERICA);
    const { car, a, b } = await setupTwo(env);
    const broken = failingDb(env, /INSERT INTO car_manager_assignments/);
    const result = await call(broken, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: b, startDate: "2026-11-15" });
    assert.equal(result.status, 500);
    const after = await call(env, "GET", `/api/portal/admin/cars/${car}/managers`);
    assert.deepEqual(historyOf(after.data), [[a, "2026-11-01", null]]);
    assert.equal((after.data?.current as { managerId: number }).managerId, a);
  });

  test("undo last: if reopening the prior row fails, the delete rolls back too", async () => {
    const env = devEnv(PANAMERICA);
    const { car, a, b } = await setupTwo(env);
    await call(env, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: b, startDate: "2026-11-15" });
    const broken = failingDb(env, /SET end_date = NULL/);
    assert.equal((await call(broken, "POST", `/api/portal/admin/cars/${car}/managers/undo`)).status, 500);
    const after = await call(env, "GET", `/api/portal/admin/cars/${car}/managers`);
    assert.deepEqual(historyOf(after.data), [
      [b, "2026-11-15", null],
      [a, "2026-11-01", "2026-11-15"],
    ]);
  });

  test("creating a manager: if the first rate insert fails, no manager row is left behind", async () => {
    const env = devEnv(PANAMERICA);
    const broken = failingDb(env, /INSERT INTO manager_share_rates/);
    assert.equal((await call(broken, "POST", "/api/portal/admin/managers", { name: "Fay Test", shareBps: 1000, effectiveFrom: "2026-10-01" })).status, 500);
    const list = await call(env, "GET", "/api/portal/admin/managers");
    assert.deepEqual(list.data?.managers, []);
  });
});
