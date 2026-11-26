import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { insertLedgerEntry, listLedgerEntries } from "../../lib/portal/db";
import type { PortalD1 } from "../../lib/portal/d1";
import type { PortalEnv } from "../../lib/portal/env";
import { createImportPreview } from "../../lib/portal/import/service";
import type { PlatformMapper } from "../../lib/portal/import/types";
import {
  carLedgerStart,
  clampToLedgerStart,
  DEFAULT_LEDGER_START_DATE,
  isMissingLedgerStartColumn,
  ledgerStartDate,
} from "../../lib/portal/ledger-start";
import { tripsForCars } from "../../lib/portal/managers";
import { listExpenses } from "../../lib/portal/money-store";
import { listIncome } from "../../lib/portal/team-store";
import { call, DEALER, devEnv, PANAMERICA, requireDb, startLedgerEarly } from "./support";

// Synthetic data only. Dates straddle the 2026-11-01 default ledger start.

/** Stub rows: id,vin,start,end,payoutCents */
const stubMapper: PlatformMapper = {
  platform: "stub",
  label: "Stub",
  canParse() {
    return false;
  },
  parse(input) {
    const lines = (input.file?.text ?? "").trim().split("\n").slice(1);
    return {
      ok: true,
      value: {
        trips: lines.map((line, index) => {
          const [externalTripId, vin, startDate, endDate, payout] = line.split(",");
          const payoutCents = Number(payout);
          return {
            rowNumber: index + 2,
            externalTripId,
            externalVehicleId: null,
            vin,
            plate: null,
            plateCandidates: [],
            startAt: `${startDate} 10:00:00`,
            endAt: `${endDate} 10:00:00`,
            startDate,
            endDate,
            status: "Completed",
            grossCents: payoutCents,
            platformFeesCents: 0,
            payoutCents,
            taxCents: null,
            pendingPayoutCents: 0,
            hasPending: false,
            countsAsIncome: true,
            error: null,
          };
        }),
        reviewItems: [],
      },
    };
  },
};

const VIN = "1TSTLDGR000000001";

async function addCar(env: PortalEnv, ownerId = 1, vin = VIN, plate = "LDGR001"): Promise<number> {
  const created = await call(env, "POST", "/api/portal/admin/cars", {
    ownerId,
    year: 2024,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: plate,
    vin,
  });
  assert.equal(created.status, 201, created.text);
  return (created.data?.car as { id: number }).id;
}

async function importRows(env: PortalEnv, rows: string[]) {
  const text = `Stub ID,VIN,Start,End,Payout\n${rows.join("\n")}\n`;
  const preview = await createImportPreview(requireDb(env), 1, {
    platform: "stub",
    file: { filename: "stub.csv", text, bytes: text.length },
    reservations: null,
    transactions: null,
  }, [stubMapper]);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const committed = await call(env, "POST", `/api/portal/admin/imports/${preview.payload.import.id}/commit`);
  assert.equal(committed.status, 200, committed.text);
}

type Totals = { incomeCents: number; expenseCents: number; netCents: number };
type Report = { monthTotals: Totals; toDate: Totals; allTime: Totals; trips: { startDate: string }[]; ledgerStartDate: string };
type Statement = {
  ledgerStartDate: string;
  statement: { month: string; openingBalanceCents: number; incomeCents: number; expenseCents: number; trips: unknown[] };
  history: { month: string; openingBalanceCents: number }[];
  totalPayoutDueCents: number;
};

async function report(env: PortalEnv, carId: number, month: string, owner = false): Promise<Report> {
  const path = owner ? `/api/portal/cars/${carId}/report?month=${month}` : `/api/portal/admin/cars/${carId}/report?month=${month}`;
  const result = await call(env, "GET", path);
  assert.equal(result.status, 200, result.text);
  return result.data as unknown as Report;
}

async function statement(env: PortalEnv, carId: number, month: string, owner = false): Promise<Statement> {
  const path = owner ? `/api/portal/cars/${carId}/statement?month=${month}` : `/api/portal/admin/cars/${carId}/statement?month=${month}`;
  const result = await call(env, "GET", path);
  assert.equal(result.status, 200, result.text);
  return result.data as unknown as Statement;
}

async function tripCount(env: PortalEnv, carId: number): Promise<number> {
  const row = await requireDb(env)
    .prepare(`SELECT COUNT(*) AS n FROM trips WHERE car_id = ?`)
    .bind(carId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** A car with Sept/Oct history plus a November trip on the 1st and one later. */
async function carWithHistory(env: PortalEnv, ownerId = 1): Promise<number> {
  const carId = await addCar(env, ownerId);
  await importRows(env, [
    `OLD1,${VIN},2026-09-10,2026-09-14,40000`,
    `OLD2,${VIN},2026-10-31,2026-11-03,30000`,
    `NOV1,${VIN},2026-11-01,2026-11-04,10000`,
    `NOV2,${VIN},2026-11-12,2026-11-15,5000`,
  ]);
  await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, {
    entryDate: "2026-10-20",
    category: "maintenance",
    amountCents: 7000,
    note: "Before start",
  });
  await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, {
    entryDate: "2026-11-05",
    category: "cleaning",
    amountCents: 1000,
    note: "Wash",
  });
  return carId;
}

describe("ledger start date", () => {
  test("helpers: default, stored value, clamp, missing column", async () => {
    assert.equal(DEFAULT_LEDGER_START_DATE, "2026-11-01");
    assert.equal(ledgerStartDate(null), "2026-11-01");
    assert.equal(ledgerStartDate("2026-12-01"), "2026-12-01");
    assert.equal(ledgerStartDate("garbage"), "2026-11-01");
    assert.deepEqual(clampToLedgerStart({ start: "2026-10-01", end: "2026-11-01" }, "2026-11-01"), {
      start: "2026-11-01",
      end: "2026-11-01",
    });
    assert.deepEqual(clampToLedgerStart({ start: "2026-11-01", end: "2026-12-01" }, "2026-11-01"), {
      start: "2026-11-01",
      end: "2026-12-01",
    });
    assert.deepEqual(clampToLedgerStart({ start: "2026-09-01", end: "2026-10-01" }, "2026-11-01"), {
      start: "2026-11-01",
      end: "2026-11-01",
    });
    assert.equal(isMissingLedgerStartColumn(new Error("D1_ERROR: no such column: ledger_start_date")), true);
    assert.equal(isMissingLedgerStartColumn(new Error("no such table: cars")), false);
    // Before migration 0011 is applied, every car gets the default.
    const preMigration = {
      prepare() {
        throw new Error("no such column: ledger_start_date");
      },
    } as unknown as PortalD1;
    assert.equal(await carLedgerStart(preMigration, 1), "2026-11-01");
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    assert.equal(await carLedgerStart(requireDb(env), carId), "2026-11-01");
  });

  test("November opens at $0 even with Sept/Oct trips and expenses on file", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await carWithHistory(env);
    const nov = await statement(env, carId, "2026-11");
    assert.equal(nov.ledgerStartDate, "2026-11-01");
    assert.equal(nov.statement.openingBalanceCents, 0);
    assert.equal(nov.statement.incomeCents, 15000);
    assert.equal(nov.statement.expenseCents, 1000);
    assert.equal(nov.statement.trips.length, 2);
    assert.deepEqual(nov.history.map((row) => row.month), ["2026-11"]);
    assert.equal(nov.history[0].openingBalanceCents, 0);
    const oct = await statement(env, carId, "2026-10");
    assert.equal(oct.statement.openingBalanceCents, 0);
    assert.equal(oct.statement.incomeCents, 0);
    assert.equal(oct.statement.expenseCents, 0);
    assert.equal(oct.statement.trips.length, 0);
    // History is kept, never deleted.
    assert.equal(await tripCount(env, carId), 4);
  });

  test("pre-start trips are out of month, to-date, all-time, and the owner view", async () => {
    const env = devEnv(PANAMERICA);
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const carId = await carWithHistory(env, 2);
    const oct = await report(env, carId, "2026-10");
    assert.equal(oct.ledgerStartDate, "2026-11-01");
    assert.equal(oct.monthTotals.incomeCents, 0);
    assert.equal(oct.monthTotals.expenseCents, 0);
    assert.equal(oct.toDate.incomeCents, 0);
    assert.equal(oct.trips.length, 0);
    const nov = await report(env, carId, "2026-11");
    assert.equal(nov.monthTotals.incomeCents, 15000);
    assert.equal(nov.toDate.incomeCents, 15000);
    assert.equal(nov.toDate.expenseCents, 1000);
    assert.equal(nov.allTime.incomeCents, 15000);
    assert.equal(nov.allTime.netCents, 14000);
    assert.deepEqual(nov.trips.map((trip) => trip.startDate), ["2026-11-01", "2026-11-12"]);

    const dealer = { ...env, PORTAL_DEV_EMAIL: DEALER };
    const ownerNov = await report(dealer, carId, "2026-11", true);
    assert.deepEqual(ownerNov.allTime, nov.allTime);
    assert.equal((await report(dealer, carId, "2026-10", true)).monthTotals.incomeCents, 0);
    const ownerStatement = await statement(dealer, carId, "2026-11", true);
    assert.equal(ownerStatement.statement.openingBalanceCents, 0);
    const ownerExpenses = await call(dealer, "GET", `/api/portal/cars/${carId}/expenses`);
    assert.deepEqual((ownerExpenses.data?.expenses as { entryDate: string }[]).map((row) => row.entryDate), ["2026-11-05"]);

    // Team income, expense lists, manager accrual, and the legacy ledger skip them too.
    const db = requireDb(env);
    assert.deepEqual((await listIncome(db, carId)).map((row) => row.start_date), ["2026-11-01", "2026-11-12"]);
    assert.equal((await listIncome(db, carId, { start: "2026-10-01", end: "2026-11-01" })).length, 0);
    assert.equal((await listExpenses(db, carId, { start: "2026-10-01", end: "2026-11-01" })).length, 0);
    const accrualTrips = (await tripsForCars(db, [carId])).get(carId) ?? [];
    assert.deepEqual(accrualTrips.map((trip) => trip.startDate), ["2026-11-01", "2026-11-12"]);
    await insertLedgerEntry(db, carId, { entryDate: "2026-10-02", type: "trip_income", amountCents: 999, note: null }, 1);
    await insertLedgerEntry(db, carId, { entryDate: "2026-11-02", type: "trip_income", amountCents: 111, note: null }, 1);
    assert.deepEqual((await listLedgerEntries(db, carId)).map((row) => row.entry_date), ["2026-11-02"]);
  });

  test("re-importing a pre-start trip leaves every balance unchanged", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await carWithHistory(env);
    const before = await statement(env, carId, "2026-11");
    const reportBefore = await report(env, carId, "2026-11");
    // The platform later reports different numbers for the old trips.
    await importRows(env, [`OLD1,${VIN},2026-09-10,2026-09-14,99000`, `OLD2,${VIN},2026-10-31,2026-11-03,1`]);
    const after = await statement(env, carId, "2026-11");
    const reportAfter = await report(env, carId, "2026-11");
    assert.deepEqual(after.statement, before.statement);
    assert.deepEqual(after.history, before.history);
    assert.equal(after.totalPayoutDueCents, before.totalPayoutDueCents);
    assert.deepEqual(reportAfter.toDate, reportBefore.toDate);
    assert.deepEqual(reportAfter.allTime, reportBefore.allTime);
    // The stored row did update (idempotent upsert), it just does not count.
    const stored = await requireDb(env)
      .prepare(`SELECT payout_cents FROM trips WHERE car_id = ? AND external_trip_id = 'OLD1'`)
      .bind(carId)
      .first<{ payout_cents: number }>();
    assert.equal(Number(stored?.payout_cents), 99000);
    assert.equal(await tripCount(env, carId), 4);
  });

  test("a trip on 11/01 counts; 10/31 does not", async () => {
    const env = devEnv(PANAMERICA);
    const carId = await addCar(env);
    await importRows(env, [`EDGE0,${VIN},2026-10-31,2026-11-01,2000`, `EDGE1,${VIN},2026-11-01,2026-11-02,3000`]);
    const nov = await report(env, carId, "2026-11");
    assert.equal(nov.monthTotals.incomeCents, 3000);
    assert.deepEqual(nov.trips.map((trip) => trip.startDate), ["2026-11-01"]);
    const st = await statement(env, carId, "2026-11");
    assert.equal(st.statement.openingBalanceCents, 0);
    assert.equal(st.statement.incomeCents, 3000);
  });

  test("the start is per car: a stored date overrides the default", async () => {
    const env = devEnv(PANAMERICA);
    const early = await carWithHistory(env);
    await startLedgerEarly(env, early, "2026-10-01");
    const nov = await statement(env, early, "2026-11");
    assert.equal(nov.ledgerStartDate, "2026-10-01");
    // October now counts: OLD2 (30000) less the October expense (7000) less its fee.
    assert.notEqual(nov.statement.openingBalanceCents, 0);
    assert.deepEqual(nov.history.map((row) => row.month), ["2026-10", "2026-11"]);
    const other = await addCar(env, 1, "1TSTLDGR000000002", "LDGR002");
    assert.equal((await statement(env, other, "2026-11")).ledgerStartDate, "2026-11-01");
  });
});
