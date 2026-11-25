import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { firstRateMoveError, moveFirstRate, parseFirstRateMove } from "../../lib/portal/managers";
import type { PortalEnv } from "../../lib/portal/env";
import { call, DEALER, devEnv, PANAMERICA, requireDb } from "./support";

async function seedCar(env: PortalEnv, plate: string, vin: string): Promise<number> {
  const result = await requireDb(env)
    .prepare(
      `INSERT INTO cars (owner_id, year, make, model, color, license_plate, vin) VALUES (1, 2022, 'Toyota', 'Corolla', 'White', ?, ?)`
    )
    .bind(plate, vin)
    .run();
  return Number(result.meta.last_row_id);
}

async function seedTrip(env: PortalEnv, carId: number, id: string, startDate: string, endDate: string, payoutCents: number) {
  await requireDb(env)
    .prepare(
      `INSERT INTO trips (car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income, payout_cents)
       VALUES (?, 'turo', ?, ?, ?, 'Completed', 1, ?)`
    )
    .bind(carId, id, startDate, endDate, payoutCents)
    .run();
}

type Rate = { id: number; effectiveFrom: string; shareBps: number };

describe("first share rate start date: pure rules", () => {
  const rates = [
    { id: 7, effective_from: "2026-11-25" },
    { id: 9, effective_from: "2026-12-15" },
  ];

  test("moving earlier is allowed and never orphans an assignment", () => {
    const check = firstRateMoveError(rates, [{ car_id: 1, start_date: "2026-11-25" }], 7, "2026-11-01");
    assert.deepEqual(check, { ok: true, from: "2026-11-25", nextFrom: "2026-12-15" });
  });

  test("only the first rate can move; later rates stay forward only", () => {
    const check = firstRateMoveError(rates, [], 9, "2026-12-01");
    assert.equal(check.ok, false);
    assert.match(!check.ok && check.status === 400 ? check.fields.effectiveFrom : "", /Only the first share rate/);
  });

  test("unknown rate id is a 404", () => {
    assert.deepEqual(firstRateMoveError(rates, [], 99, "2026-11-01"), { ok: false, status: 404 });
  });

  test("same date, and on or after the next rate, are refused", () => {
    const same = firstRateMoveError(rates, [], 7, "2026-11-25");
    assert.match(!same.ok && same.status === 400 ? same.fields.effectiveFrom : "", /already starts on 2026-11-25/);
    for (const date of ["2026-12-15", "2026-12-20"]) {
      const late = firstRateMoveError(rates, [], 7, date);
      assert.match(!late.ok && late.status === 400 ? late.fields.effectiveFrom : "", /before 2026-12-15/);
    }
  });

  test("moving later past an assignment start is blocked with the car named", () => {
    const check = firstRateMoveError(
      [{ id: 7, effective_from: "2026-11-01" }],
      [
        { car_id: 2, start_date: "2026-11-05", car_year: 2014, car_make: "Kia", car_model: "Soul", car_license_plate: "ABC123" },
        { car_id: 3, start_date: "2026-11-01" },
      ],
      7,
      "2026-11-10"
    );
    assert.equal(check.ok, false);
    const message = !check.ok && check.status === 400 ? check.fields.effectiveFrom : "";
    assert.match(message, /Car 3 and 1 more is assigned to this manager from 2026-11-01/);
    assert.match(message, /Use 2026-11-01 or earlier/);
    const named = firstRateMoveError([{ id: 7, effective_from: "2026-11-01" }], [{ car_id: 2, start_date: "2026-11-05", car_year: 2014, car_make: "Kia", car_model: "Soul", car_license_plate: "ABC123" }], 7, "2026-11-10");
    assert.match(!named.ok && named.status === 400 ? named.fields.effectiveFrom : "", /^2014 Kia Soul \(ABC123\) is assigned/);
    // On the assignment's own start date is fine (start is inclusive).
    assert.equal(firstRateMoveError([{ id: 7, effective_from: "2026-11-01" }], [{ car_id: 3, start_date: "2026-11-05" }], 7, "2026-11-05").ok, true);
  });

  test("parse: effectiveFrom only; a share is refused", () => {
    assert.deepEqual(parseFirstRateMove({ effectiveFrom: "2026-11-01" }), { ok: true, value: { effectiveFrom: "2026-11-01" } });
    const share = parseFirstRateMove({ effectiveFrom: "2026-11-01", shareBps: 9000 });
    assert.equal(share.ok, false);
    assert.ok(!share.ok && share.fields.shareBps);
    assert.equal(parseFirstRateMove({ effectiveFrom: "2026-02-30" }).ok, false);
    assert.equal(parseFirstRateMove([]).ok, false);
  });
});

describe("first share rate start date: routes", () => {
  test("added late, then backdated: cars can be assigned from the real start and trips accrue", async () => {
    const env = devEnv(PANAMERICA);
    const carA = await seedCar(env, "TEST101", "1HGCM82633A004401");
    const carB = await seedCar(env, "TEST102", "1HGCM82633A004402");
    const created = await call(env, "POST", "/api/portal/admin/managers", { name: "Ari Test", email: "ari.test@example.com", shareBps: 5000, effectiveFrom: "2026-11-25" });
    assert.equal(created.status, 201);
    const manager = created.data?.manager as { id: number; rates: Rate[] };
    const rateId = manager.rates[0].id;
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${carA}/managers`, { managerId: manager.id, startDate: "2026-11-25" })).status, 201);

    // Before the correction, an 11/1 assignment is refused with a pointer to the fix.
    const early = await call(env, "POST", `/api/portal/admin/cars/${carB}/managers`, { managerId: manager.id, startDate: "2026-11-01" });
    assert.equal(early.status, 400);
    assert.match(JSON.stringify(early.data), /correct their start date/);

    const moved = await call(env, "PATCH", `/api/portal/admin/managers/${manager.id}/rates/${rateId}`, { effectiveFrom: "2026-11-01" });
    assert.equal(moved.status, 200);
    const rates = (moved.data?.manager as { rates: Rate[] }).rates;
    assert.deepEqual(rates.map((r) => [r.id, r.effectiveFrom, r.shareBps]), [[rateId, "2026-11-01", 5000]]);

    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${carB}/managers`, { managerId: manager.id, startDate: "2026-11-01" })).status, 201);
    await seedTrip(env, carB, "S1", "2026-10-31", "2026-11-02", 50000);
    await seedTrip(env, carB, "S2", "2026-11-01", "2026-11-03", 50000);
    const detail = await call(env, "GET", `/api/portal/admin/managers/${manager.id}`);
    const accrual = detail.data?.accrual as { trips: { startDate: string; shareBps: number; shareCents: number }[] };
    // 20% tier fee on $500 = $100; 50% share = $50. The 10/31 trip is before she started.
    assert.deepEqual(accrual.trips.map((t) => [t.startDate, t.shareBps, t.shareCents]), [["2026-11-01", 5000, 5000]]);

    // Moving it back later past car B's 11/1 assignment is blocked, and nothing changes.
    const later = await call(env, "PATCH", `/api/portal/admin/managers/${manager.id}/rates/${rateId}`, { effectiveFrom: "2026-11-10" });
    assert.equal(later.status, 400);
    assert.match(JSON.stringify(later.data), /assigned to this manager from 2026-11-01/);
    const after = (await call(env, "GET", `/api/portal/admin/managers/${manager.id}/rates`)).data?.rates as Rate[];
    assert.deepEqual(after.map((r) => r.effectiveFrom), ["2026-11-01"]);
  });

  test("later rates can't be moved; the first can't pass the next; other managers' rates 404", async () => {
    const env = devEnv(PANAMERICA);
    const one = (await call(env, "POST", "/api/portal/admin/managers", { name: "Bea Test", email: "bea.test@example.com", shareBps: 1000, effectiveFrom: "2026-11-01" })).data?.manager as { id: number };
    const two = (await call(env, "POST", "/api/portal/admin/managers", { name: "Cal Test", email: "cal.test@example.com", shareBps: 1000, effectiveFrom: "2026-11-01" })).data?.manager as { id: number; rates: Rate[] };
    assert.equal((await call(env, "POST", `/api/portal/admin/managers/${one.id}/rates`, { shareBps: 2000, effectiveFrom: "2026-12-01" })).status, 201);
    const rates = (await call(env, "GET", `/api/portal/admin/managers/${one.id}/rates`)).data?.rates as Rate[];
    const [first, second] = rates;

    const moveSecond = await call(env, "PATCH", `/api/portal/admin/managers/${one.id}/rates/${second.id}`, { effectiveFrom: "2026-11-15" });
    assert.equal(moveSecond.status, 400);
    assert.match(JSON.stringify(moveSecond.data), /forward only/);
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${one.id}/rates/${first.id}`, { effectiveFrom: "2026-12-01" })).status, 400);
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${one.id}/rates/${first.id}`, { effectiveFrom: "2026-11-01", shareBps: 9000 })).status, 400);
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${one.id}/rates/${two.rates[0].id}`, { effectiveFrom: "2026-10-01" })).status, 404);
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/9999/rates/${first.id}`, { effectiveFrom: "2026-10-01" })).status, 404);
    assert.equal((await call(env, "GET", `/api/portal/admin/managers/${one.id}/rates/${first.id}`)).status, 405);
    // Moving later, still before the next rate and with no cars, is fine.
    assert.equal((await call(env, "PATCH", `/api/portal/admin/managers/${one.id}/rates/${first.id}`, { effectiveFrom: "2026-11-20" })).status, 200);
    const final = (await call(env, "GET", `/api/portal/admin/managers/${one.id}/rates`)).data?.rates as Rate[];
    assert.deepEqual(final.map((r) => [r.effectiveFrom, r.shareBps]), [["2026-11-20", 1000], ["2026-12-01", 2000]]);
  });

  test("the SQL guard refuses a stale or orphaning write even past the route check", async () => {
    const env = devEnv(PANAMERICA);
    const car = await seedCar(env, "TEST103", "1HGCM82633A004403");
    const m = (await call(env, "POST", "/api/portal/admin/managers", { name: "Dot Test", email: "dot.test@example.com", shareBps: 1000, effectiveFrom: "2026-11-01" })).data?.manager as { id: number; rates: Rate[] };
    assert.equal((await call(env, "POST", `/api/portal/admin/cars/${car}/managers`, { managerId: m.id, startDate: "2026-11-05" })).status, 201);
    const db = requireDb(env);
    assert.equal(await moveFirstRate(db, m.id, m.rates[0].id, "2026-10-01", "2026-10-15"), 0, "stale from date");
    assert.equal(await moveFirstRate(db, m.id, m.rates[0].id, "2026-11-01", "2026-11-10"), 0, "would orphan the 11/5 assignment");
    assert.equal(await moveFirstRate(db, m.id, m.rates[0].id, "2026-11-01", "2026-10-20"), 1);
  });

  test("adding a manager on an existing account can start the share in the past", async () => {
    const env = devEnv(PANAMERICA);
    const owner = await requireDb(env)
      .prepare(`INSERT INTO owners (name, email, is_admin) VALUES ('Eve Owner', 'eve.owner@example.com', 0)`)
      .run();
    const ownerId = Number(owner.meta.last_row_id);
    const created = await call(env, "POST", "/api/portal/admin/managers", { name: "Eve Owner", ownerId, confirm: true, shareBps: 2500, effectiveFrom: "2026-11-01" });
    assert.equal(created.status, 201);
    assert.deepEqual((created.data?.manager as { rates: Rate[] }).rates.map((r) => r.effectiveFrom), ["2026-11-01"]);
  });

  test("non-admins get 403 on the correction route", async () => {
    const env = devEnv(PANAMERICA);
    await requireDb(env).prepare(`INSERT INTO owners (name, email, is_admin) VALUES ('Dealer', ?, 0)`).bind(DEALER).run();
    const result = await call({ ...env, PORTAL_DEV_EMAIL: DEALER }, "PATCH", "/api/portal/admin/managers/1/rates/1", { effectiveFrom: "2026-11-01" });
    assert.equal(result.status, 403);
  });
});
