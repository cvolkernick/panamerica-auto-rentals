import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { randomToken, sha256Hex } from "../../lib/portal/codec";
import { insertSession } from "../../lib/portal/db";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { createImportPreview } from "../../lib/portal/import/service";
import type { PlatformMapper } from "../../lib/portal/import/types";
import { turoCountsAsIncome } from "../../lib/portal/import/turo";
import { SESSION_COOKIE } from "../../lib/portal/session";
import {
  buildStatements,
  feeForTrip,
  feeRateBps,
  managementFeeCents,
  tripLengthDays,
  type MonthStatement,
  type StatementTripInput,
} from "../../lib/portal/statement";
import { parsePayoutCreate } from "../../lib/portal/validate";
import { call, DEALER, devEnv, PANAMERICA, request, requireDb } from "./support";

function trip(overrides: Partial<StatementTripInput> & { startDate: string }): StatementTripInput {
  return {
    id: 1,
    platform: "turo",
    externalTripId: "T1",
    endDate: overrides.startDate,
    status: "Completed",
    countsAsIncome: true,
    incomeCents: 0,
    hasPending: false,
    pendingPayoutCents: null,
    ...overrides,
  };
}

function byMonth(statements: MonthStatement[], month: string): MonthStatement {
  const found = statements.find((statement) => statement.month === month);
  assert.ok(found, `missing ${month}`);
  return found;
}

describe("management fee", () => {
  test("trip length is calendar days from start to end, at least 1", () => {
    assert.equal(tripLengthDays("2026-11-01", "2026-11-08"), 7);
    assert.equal(tripLengthDays("2026-11-01", "2026-11-01"), 1);
    assert.equal(tripLengthDays("2026-11-01", null), 1);
    assert.equal(tripLengthDays("2026-10-31", "2026-11-21"), 21);
    assert.equal(tripLengthDays("2026-03-01", "2026-03-09"), 8);
  });

  test("7 and 21 days are both 15%; 6 days is 20%; 22 days is 10%", () => {
    assert.equal(feeRateBps(1), 2000);
    assert.equal(feeRateBps(6), 2000);
    assert.equal(feeRateBps(7), 1500);
    assert.equal(feeRateBps(21), 1500);
    assert.equal(feeRateBps(22), 1000);
    const seven = feeForTrip(trip({ startDate: "2026-11-01", endDate: "2026-11-08", incomeCents: 100000 }));
    assert.equal(seven.days, 7);
    assert.equal(seven.feeCents, 15000);
    const twentyOne = feeForTrip(trip({ startDate: "2026-11-01", endDate: "2026-11-22", incomeCents: 100000 }));
    assert.equal(twentyOne.days, 21);
    assert.equal(twentyOne.feeCents, 15000);
    const six = feeForTrip(trip({ startDate: "2026-11-01", endDate: "2026-11-07", incomeCents: 100000 }));
    assert.equal(six.feeCents, 20000);
    const twentyTwo = feeForTrip(trip({ startDate: "2026-11-01", endDate: "2026-11-23", incomeCents: 100000 }));
    assert.equal(twentyTwo.feeCents, 10000);
  });

  test("rounds per trip to whole cents, half up", () => {
    assert.equal(managementFeeCents(12345, 1500), 1852); // 1851.75
    assert.equal(managementFeeCents(10, 1500), 2); // 1.5 rounds up
    assert.equal(managementFeeCents(30, 1500), 5); // 4.5 rounds up
    assert.equal(managementFeeCents(1, 2000), 0); // 0.2
    assert.equal(managementFeeCents(0, 2000), 0);
    assert.equal(managementFeeCents(-5000, 2000), 0);
    assert.throws(() => managementFeeCents(10.5, 2000));
    const statements = buildStatements({
      trips: [
        trip({ id: 1, startDate: "2026-11-01", endDate: "2026-11-03", incomeCents: 10 }),
        trip({ id: 2, startDate: "2026-11-05", endDate: "2026-11-07", incomeCents: 10 }),
      ],
      expenses: [],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-12",
    });
    assert.equal(byMonth(statements, "2026-11").managementFeeCents, 4); // 2 + 2, not round(4.0)
  });

  test("trips that do not count as income earn no fee and no income", () => {
    const statements = buildStatements({
      trips: [trip({ startDate: "2026-11-01", endDate: "2026-11-04", incomeCents: 50000, countsAsIncome: false, status: "Booked" })],
      expenses: [],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-12",
    });
    const nov = byMonth(statements, "2026-11");
    assert.equal(nov.incomeCents, 0);
    assert.equal(nov.managementFeeCents, 0);
    assert.equal(nov.trips.length, 1);
  });

  test("cancellation-fee income is fee-bearing at the booked trip length", () => {
    assert.equal(turoCountsAsIncome("Guest cancellation", 4500), true);
    const statements = buildStatements({
      trips: [
        trip({
          startDate: "2026-11-10",
          endDate: "2026-11-12",
          status: "Guest cancellation",
          countsAsIncome: turoCountsAsIncome("Guest cancellation", 4500),
          incomeCents: 4500,
        }),
      ],
      expenses: [],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-12",
    });
    const nov = byMonth(statements, "2026-11");
    assert.equal(nov.incomeCents, 4500);
    assert.equal(nov.managementFeeCents, 900);
    assert.equal(nov.closingBalanceCents, 3600);
    assert.equal(nov.payoutDueCents, 3600);
  });
});

describe("running balance", () => {
  test("onboarding: October road-ready work, no trips, is covered by later income", () => {
    const statements = buildStatements({
      trips: [
        trip({ id: 1, externalTripId: "A", startDate: "2026-11-03", endDate: "2026-11-08", incomeCents: 50000 }),
        trip({ id: 2, externalTripId: "B", startDate: "2026-12-01", endDate: "2026-12-11", incomeCents: 100000 }),
      ],
      expenses: [{ id: 1, entryDate: "2026-10-12", category: "maintenance", amountCents: 80000, note: "Road ready" }],
      payouts: [],
      lastMonth: "2026-12",
      currentMonth: "2027-01",
    });
    assert.deepEqual(statements.map((statement) => statement.month), ["2026-10", "2026-11", "2026-12"]);
    const oct = byMonth(statements, "2026-10");
    assert.equal(oct.carryInCents, 0);
    assert.equal(oct.incomeCents, 0);
    assert.equal(oct.managementFeeCents, 0);
    assert.equal(oct.closingBalanceCents, -80000);
    assert.equal(oct.payoutDueCents, 0);
    assert.equal(oct.carryOutCents, -80000);
    const nov = byMonth(statements, "2026-11");
    assert.equal(nov.carryInCents, -80000);
    assert.equal(nov.managementFeeCents, 10000); // 5 days, 20% of 500.00, on revenue only
    assert.equal(nov.closingBalanceCents, -40000);
    assert.equal(nov.payoutDueCents, 0);
    const dec = byMonth(statements, "2026-12");
    assert.equal(dec.carryInCents, -40000);
    assert.equal(dec.managementFeeCents, 15000); // 10 days, 15%
    assert.equal(dec.closingBalanceCents, 45000);
    assert.equal(dec.payoutDueCents, 45000);
    assert.equal(dec.carryOutCents, 0);
  });

  test("a multi-month shortfall keeps accruing until income covers it", () => {
    const statements = buildStatements({
      trips: [
        trip({ id: 1, startDate: "2026-02-02", endDate: "2026-02-04", incomeCents: 10000 }),
        trip({ id: 2, startDate: "2026-04-02", endDate: "2026-04-04", incomeCents: 100000 }),
      ],
      expenses: [
        { id: 1, entryDate: "2026-01-05", category: "registration", amountCents: 30000, note: null },
        { id: 2, entryDate: "2026-02-10", category: "insurance", amountCents: 20000, note: null },
        { id: 3, entryDate: "2026-03-10", category: "insurance", amountCents: 20000, note: null },
      ],
      payouts: [],
      lastMonth: "2026-04",
      currentMonth: "2026-05",
    });
    const values = statements.map((s) => [s.month, s.carryInCents, s.closingBalanceCents, s.payoutDueCents]);
    assert.deepEqual(values, [
      ["2026-01", 0, -30000, 0],
      ["2026-02", -30000, -42000, 0], // +100 income -20 fee -200 expense
      ["2026-03", -42000, -62000, 0], // no income, fee 0
      ["2026-04", -62000, 18000, 18000], // +1000 -200 fee
    ]);
    assert.equal(byMonth(statements, "2026-03").managementFeeCents, 0);
  });

  test("never pools across cars: each car is built from its own rows", () => {
    const carA = buildStatements({
      trips: [],
      expenses: [{ id: 1, entryDate: "2026-11-01", category: "maintenance", amountCents: 50000, note: null }],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-12",
    });
    const carB = buildStatements({
      trips: [trip({ startDate: "2026-11-01", endDate: "2026-11-03", incomeCents: 100000 })],
      expenses: [],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-12",
    });
    assert.equal(byMonth(carA, "2026-11").carryOutCents, -50000);
    assert.equal(byMonth(carB, "2026-11").payoutDueCents, 80000);
  });

  test("payouts reduce what is due; overpaying carries forward as a shortfall", () => {
    const statements = buildStatements({
      trips: [
        trip({ id: 1, startDate: "2026-06-01", endDate: "2026-06-03", incomeCents: 10000 }),
        trip({ id: 2, startDate: "2026-07-01", endDate: "2026-07-03", incomeCents: 10000 }),
      ],
      expenses: [],
      payouts: [
        { id: 1, periodMonth: "2026-06", paidDate: "2026-07-02", amountCents: 3000, note: null },
        { id: 2, periodMonth: "2026-06", paidDate: "2026-07-05", amountCents: 6000, note: null },
      ],
      lastMonth: "2026-07",
      currentMonth: "2026-08",
    });
    const june = byMonth(statements, "2026-06");
    assert.equal(june.closingBalanceCents, 8000);
    assert.equal(june.paidCents, 9000);
    assert.equal(june.overpaidCents, 1000);
    assert.equal(june.payoutDueCents, 0);
    assert.equal(june.carryOutCents, -1000);
    const july = byMonth(statements, "2026-07");
    assert.equal(july.carryInCents, -1000);
    assert.equal(july.closingBalanceCents, 7000);
    assert.equal(july.payoutDueCents, 7000);
  });

  test("the current month is marked open", () => {
    const statements = buildStatements({
      trips: [trip({ startDate: "2026-11-01", endDate: "2026-11-03", incomeCents: 100 })],
      expenses: [],
      payouts: [],
      lastMonth: "2026-11",
      currentMonth: "2026-11",
    });
    assert.equal(byMonth(statements, "2026-11").open, true);
  });
});

describe("payout validation", () => {
  test("accepts a short note and rejects payment details or future months", () => {
    const ok = parsePayoutCreate(
      { periodMonth: "2026-10", paidDate: "2026-11-05", amountCents: 45000, note: "October payout" },
      "2026-11"
    );
    assert.equal(ok.ok, true);
    for (const note of ["Zelle owner@example.com", "acct 123456789", "call 305-555-0100"]) {
      const bad = parsePayoutCreate({ periodMonth: "2026-10", paidDate: "2026-11-05", amountCents: 1, note }, "2026-11");
      assert.equal(bad.ok, false, note);
    }
    const future = parsePayoutCreate({ periodMonth: "2026-12", paidDate: "2026-11-05", amountCents: 1 }, "2026-11");
    assert.equal(future.ok, false);
    const fraction = parsePayoutCreate({ periodMonth: "2026-10", paidDate: "2026-11-05", amountCents: 1.5 }, "2026-11");
    assert.equal(fraction.ok, false);
  });
});

// ---- API ----

function carBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 1,
    year: 2024,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: "TEST001",
    vin: "1TSTCAR0000000001",
    ...overrides,
  };
}

/** Stub rows: id,vin,start,end,payoutCents,taxCents,status */
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
          const [externalTripId, vin, startDate, endDate, payout, tax, status] = line.split(",");
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
            status: status || "Completed",
            grossCents: payoutCents,
            platformFeesCents: 0,
            payoutCents,
            taxCents: tax ? Number(tax) : null,
            pendingPayoutCents: 0,
            hasPending: false,
            countsAsIncome: (status || "Completed") !== "Booked",
            error: null,
          };
        }),
        reviewItems: [],
      },
    };
  },
};

async function importStub(env: PortalEnv, rows: string[]) {
  const text = `Stub ID,VIN,Start,End,Payout,Tax,Status\n${rows.join("\n")}\n`;
  const preview = await createImportPreview(requireDb(env), 1, {
    platform: "stub",
    file: { filename: "stub.csv", text, bytes: text.length },
    reservations: null,
    transactions: null,
  }, [stubMapper]);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const committed = await call(env, "POST", `/api/portal/admin/imports/${preview.payload.import.id}/commit`);
  assert.equal(committed.status, 200);
}

type StatementJson = {
  statement: MonthStatement;
  history: { month: string; closingBalanceCents: number; payoutDueCents: number; carryOutCents: number }[];
  totalPayoutDueCents: number;
  car: Record<string, unknown>;
};

async function statementOf(env: PortalEnv, carId: number, month: string, owner = false) {
  const path = owner ? `/api/portal/cars/${carId}/statement?month=${month}` : `/api/portal/admin/cars/${carId}/statement?month=${month}`;
  const result = await call(env, "GET", path);
  assert.equal(result.status, 200, result.text);
  return result.data as unknown as StatementJson;
}

describe("statement API", () => {
  test("onboarding expense, fee on revenue, and payout only once positive", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, {
      entryDate: "2025-10-15",
      category: "maintenance",
      amountCents: 80000,
      note: "Road-ready work",
    });
    await importStub(env, [
      "S1,1TSTCAR0000000001,2025-11-03,2025-11-08,50000,,Completed",
      // Wheelbase-style: payout includes 7.00 tax; fee base is 1000.00 after the tax pass-through.
      "S2,1TSTCAR0000000001,2025-12-01,2025-12-08,100700,700,Completed",
      "S3,1TSTCAR0000000001,2025-12-20,2025-12-22,99999,,Booked",
    ]);
    const oct = await statementOf(env, carId, "2025-10");
    assert.equal(oct.statement.closingBalanceCents, -80000);
    assert.equal(oct.statement.payoutDueCents, 0);
    assert.equal(oct.statement.managementFeeCents, 0);
    const nov = await statementOf(env, carId, "2025-11");
    assert.equal(nov.statement.carryInCents, -80000);
    assert.equal(nov.statement.managementFeeCents, 10000);
    assert.equal(nov.statement.closingBalanceCents, -40000);
    assert.equal(nov.statement.payoutDueCents, 0);
    const dec = await statementOf(env, carId, "2025-12");
    assert.equal(dec.statement.incomeCents, 100000);
    assert.equal(dec.statement.managementFeeCents, 15000);
    assert.equal(dec.statement.closingBalanceCents, 45000);
    assert.equal(dec.statement.payoutDueCents, 45000);
    assert.equal(dec.statement.trips.length, 2);
    assert.equal(dec.totalPayoutDueCents, 45000);
    const before = await statementOf(env, carId, "2025-08");
    assert.equal(before.statement.closingBalanceCents, 0);
    assert.equal(before.statement.trips.length, 0);
    const text = JSON.stringify(dec);
    assert.equal(/guest/i.test(text), false);
  });

  test("admin records and deletes payouts; owners read only their own cars", async () => {
    const env = devEnv(PANAMERICA);
    const own = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const ownId = (own.data?.car as { id: number }).id;
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const other = await call(env, "POST", "/api/portal/admin/cars", carBody({
      ownerId: 2,
      licensePlate: "TEST002",
      vin: "1TSTCAR0000000002",
    }));
    const otherId = (other.data?.car as { id: number }).id;
    await importStub(env, [
      "S1,1TSTCAR0000000001,2025-11-03,2025-11-06,10000,,Completed",
      "S2,1TSTCAR0000000002,2025-11-03,2025-11-06,20000,,Completed",
    ]);
    const paid = await call(env, "POST", `/api/portal/admin/cars/${otherId}/payouts`, {
      periodMonth: "2025-11",
      paidDate: "2025-12-05",
      amountCents: 16000,
      note: "November",
    });
    assert.equal(paid.status, 201, paid.text);
    const payoutId = (paid.data?.payout as { id: number }).id;
    const bad = await call(env, "POST", `/api/portal/admin/cars/${otherId}/payouts`, {
      periodMonth: "2025-11",
      paidDate: "2025-12-05",
      amountCents: 100,
      note: "routing 021000021",
    });
    assert.equal(bad.status, 400);

    const dealer = { ...env, PORTAL_DEV_EMAIL: DEALER };
    const mine = await statementOf(dealer, otherId, "2025-11", true);
    assert.equal(mine.statement.paidCents, 16000);
    assert.equal(mine.statement.payoutDueCents, 0);
    assert.equal(mine.statement.payouts.length, 1);
    assert.equal((await call(dealer, "GET", `/api/portal/cars/${ownId}/statement?month=2025-11`)).status, 404);
    assert.equal((await call(dealer, "GET", `/api/portal/cars/${ownId}/payouts`)).status, 404);
    const list = await call(dealer, "GET", `/api/portal/cars/${otherId}/payouts`);
    assert.equal(list.status, 200);
    assert.equal((list.data?.payouts as unknown[]).length, 1);
    assert.equal((await call(dealer, "GET", `/api/portal/admin/cars/${otherId}/statement?month=2025-11`)).status, 403);
    assert.equal((await call(dealer, "POST", `/api/portal/admin/cars/${otherId}/payouts`, {
      periodMonth: "2025-11",
      paidDate: "2025-12-05",
      amountCents: 1,
    })).status, 403);
    assert.equal((await call(dealer, "DELETE", `/api/portal/admin/cars/${otherId}/payouts/${payoutId}`)).status, 403);
    assert.equal((await call(dealer, "POST", `/api/portal/cars/${otherId}/payouts`, { amountCents: 1 })).status, 404);
    // The admin's own car is unaffected by the dealer car's payout.
    const adminCar = await statementOf(env, ownId, "2025-11");
    assert.equal(adminCar.statement.paidCents, 0);
    assert.equal(adminCar.statement.payoutDueCents, 8000);
    // Wrong car id in the path cannot delete another car's payout.
    assert.equal((await call(env, "DELETE", `/api/portal/admin/cars/${ownId}/payouts/${payoutId}`)).status, 404);
    assert.equal((await call(env, "DELETE", `/api/portal/admin/cars/${otherId}/payouts/${payoutId}`)).status, 200);
    const after = await statementOf(env, otherId, "2025-11");
    assert.equal(after.statement.paidCents, 0);
    assert.equal(after.statement.payoutDueCents, 16000);
    // A car with payouts cannot be deleted.
    await call(env, "POST", `/api/portal/admin/cars/${otherId}/payouts`, {
      periodMonth: "2025-11",
      paidDate: "2025-12-05",
      amountCents: 100,
    });
    const blocked = await call(env, "DELETE", `/api/portal/admin/cars/${otherId}`);
    assert.equal(blocked.status, 409);
  });

  test("a re-import after a payout never edits the payout; the difference flows into the balance", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    await importStub(env, ["S1,1TSTCAR0000000001,2025-09-03,2025-09-06,10000,,Completed"]);
    const paid = await call(env, "POST", `/api/portal/admin/cars/${carId}/payouts`, {
      periodMonth: "2025-09",
      paidDate: "2025-10-03",
      amountCents: 8000,
    });
    assert.equal(paid.status, 201);
    // Platform later reports less for the same trip.
    await importStub(env, [
      "S1,1TSTCAR0000000001,2025-09-03,2025-09-06,6000,,Completed",
      "S2,1TSTCAR0000000001,2025-10-03,2025-10-06,10000,,Completed",
    ]);
    const sep = await statementOf(env, carId, "2025-09");
    assert.equal(sep.statement.closingBalanceCents, 4800);
    assert.equal(sep.statement.paidCents, 8000);
    assert.equal(sep.statement.overpaidCents, 3200);
    assert.equal(sep.statement.payoutDueCents, 0);
    assert.equal(sep.statement.carryOutCents, -3200);
    assert.equal(sep.statement.payouts[0]?.amountCents, 8000);
    const oct = await statementOf(env, carId, "2025-10");
    assert.equal(oct.statement.carryInCents, -3200);
    assert.equal(oct.statement.closingBalanceCents, 4800);
    assert.equal(oct.statement.payoutDueCents, 4800);
    // Platform later reports more: the extra is owed on the original month.
    await importStub(env, ["S1,1TSTCAR0000000001,2025-09-03,2025-09-06,12000,,Completed"]);
    const sepUp = await statementOf(env, carId, "2025-09");
    assert.equal(sepUp.statement.closingBalanceCents, 9600);
    assert.equal(sepUp.statement.payoutDueCents, 1600);
    assert.equal(sepUp.statement.payouts[0]?.amountCents, 8000);
    const payouts = await call(env, "GET", `/api/portal/admin/cars/${carId}/payouts`);
    assert.deepEqual((payouts.data?.payouts as { amountCents: number }[]).map((row) => row.amountCents), [8000]);
  });

  test("payout writes need the session CSRF token and a same-origin request", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const db = requireDb(env);
    const token = randomToken();
    const csrf = randomToken();
    const now = new Date();
    await insertSession(
      db,
      await sha256Hex(token),
      1,
      csrf,
      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      now.toISOString()
    );
    const sessionEnv: PortalEnv = { DB: db };
    const cookie = `${SESSION_COOKIE}=${token}`;
    const body = { periodMonth: "2025-11", paidDate: "2025-12-01", amountCents: 500 };
    const path = `/api/portal/admin/cars/${carId}/payouts`;
    const wrong = await handlePortal(request("POST", path, { body, headers: { cookie, "x-csrf-token": "wrong" } }), sessionEnv);
    assert.equal(wrong.status, 403);
    assert.equal(((await wrong.json()) as { reason?: string }).reason, "csrf");
    const missing = await handlePortal(request("POST", path, { body, headers: { cookie } }), sessionEnv);
    assert.equal(missing.status, 403);
    const crossSite = await handlePortal(
      request("POST", path, { body, origin: "https://evil.example", headers: { cookie, "x-csrf-token": csrf } }),
      sessionEnv
    );
    assert.equal(crossSite.status, 403);
    const accepted = await handlePortal(request("POST", path, { body, headers: { cookie, "x-csrf-token": csrf } }), sessionEnv);
    assert.equal(accepted.status, 201);
    const payoutId = ((await accepted.json()) as { payout: { id: number } }).payout.id;
    const deleteWrong = await handlePortal(
      request("DELETE", `${path}/${payoutId}`, { headers: { cookie, "x-csrf-token": "wrong" } }),
      sessionEnv
    );
    assert.equal(deleteWrong.status, 403);
    const deleted = await handlePortal(
      request("DELETE", `${path}/${payoutId}`, { headers: { cookie, "x-csrf-token": csrf } }),
      sessionEnv
    );
    assert.equal(deleted.status, 200);
  });
});
