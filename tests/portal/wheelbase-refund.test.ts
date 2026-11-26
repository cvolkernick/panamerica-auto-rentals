import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WHEELBASE_REFUND_TYPES, wheelbaseMapper } from "../../lib/portal/import/wheelbase";
import { call, csvFile, devEnv, PANAMERICA, requireDb, uploadImport } from "./support";

// Synthetic data only. Booking ids, plates, and amounts are made up.
const RESERVATIONS_HEADER = "Booking ID,Status,Vehicle Internal ID,Start,End,Start Time,End Time,Subtotal";
const TRANSACTIONS_HEADER = "Date,Deposit Date,Reservation,Type,Amount,CC Fee,Wheelbase Fee,Credit,Debit";

const RESERVATION = "91000001,On Vacation,Rio-TEST101,2026-11-20,2026-11-27,36000,36000,280.00";
const CHARGE = "2026-11-20,2026-11-21,#91000001 - Test Guest,Full Reservation Charge,$300.00,$9.00,$0.00,$291.00,$0.00";
const WB_FEE = "2026-11-20,2026-11-21,#91000001 - Test Guest,Wheelbase Fee Payment,$4.00,$0.00,$4.00,$0.00,$4.00";
const REFUND = "2026-11-25,2026-11-25,#91000001 - Test Guest,Refund,($100.00),($3.00),$0.00,$0.00,$0.00";
const REVERSAL = "2026-11-25,0001-01-01,#91000001 - Test Guest,Reversal,($100.00),($3.00),$0.00,$0.00,$97.00";

function parse(reservationRows: string[], transactionRows: string[]) {
  const reservations = [RESERVATIONS_HEADER, ...reservationRows].join("\n");
  const transactions = [TRANSACTIONS_HEADER, ...transactionRows].join("\n");
  const parsed = wheelbaseMapper.parse({
    reservations: { filename: "booking-export.csv", text: reservations, bytes: reservations.length },
    transactions: { filename: "transactions-export.csv", text: transactions, bytes: transactions.length },
  });
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  assert.equal(JSON.stringify(parsed.value).includes("Test Guest"), false);
  return parsed.value;
}

describe("wheelbase refunds", () => {
  test("Refund and Reversal are mapped types", () => {
    assert.deepEqual([...WHEELBASE_REFUND_TYPES], ["Refund", "Reversal"]);
  });

  test("a matched Refund + Reversal pair is counted once, from the Reversal", () => {
    const value = parse([RESERVATION], [CHARGE, WB_FEE, REFUND, REVERSAL]);
    assert.deepEqual(value.reviewItems, []);
    assert.equal(value.trips.length, 1);
    const trip = value.trips[0];
    // Before the refund: payout 291.00 - 4.00 = 287.00, fees 9.00 + 4.00 = 13.00.
    // The refund takes back 100.00 minus the 3.00 card fee that comes back with it.
    assert.equal(trip.payoutCents, 28700 - 9700);
    assert.equal(trip.platformFeesCents, 1300 - 300);
    assert.equal(trip.grossCents, 28000);
    assert.equal(trip.hasPending, true);
    assert.equal(trip.pendingPayoutCents, -9700);
    assert.equal(trip.countsAsIncome, true);
    assert.equal(trip.error, null);
  });

  test("row order does not matter and positive Amount cells pair too", () => {
    const positiveRefund = REFUND.replace("($100.00)", "$100.00");
    const value = parse([RESERVATION], [REVERSAL, CHARGE, positiveRefund]);
    assert.deepEqual(value.reviewItems, []);
    assert.equal(value.trips[0].payoutCents, 29100 - 9700);
  });

  test("two refunds on one booking pair by amount", () => {
    const refund2 = "2026-11-26,2026-11-26,#91000001 - Test Guest,Refund,($50.00),($1.50),$0.00,$0.00,$0.00";
    const reversal2 = "2026-11-26,0001-01-01,#91000001 - Test Guest,Reversal,($50.00),($1.50),$0.00,$0.00,$48.50";
    const value = parse([RESERVATION], [CHARGE, refund2, REFUND, reversal2, REVERSAL]);
    assert.deepEqual(value.reviewItems, []);
    assert.equal(value.trips[0].payoutCents, 29100 - 9700 - 4850);
    assert.equal(value.trips[0].platformFeesCents, 900 - 300 - 150);
  });

  test("a Refund with no Reversal stays in review and does not touch payout", () => {
    const value = parse([RESERVATION], [CHARGE, REFUND]);
    assert.equal(value.trips[0].payoutCents, 29100);
    assert.equal(value.trips[0].platformFeesCents, 900);
    assert.equal(value.reviewItems.length, 1);
    assert.equal(value.reviewItems[0].kind, "unparsed");
    assert.equal(value.reviewItems[0].typeRaw, "Refund");
    assert.equal(value.reviewItems[0].externalTripId, "91000001");
    assert.equal(value.reviewItems[0].detail.reason, "refund_without_reversal");
  });

  test("a Reversal with no Refund stays in review and does not touch payout", () => {
    const value = parse([RESERVATION], [CHARGE, REVERSAL]);
    assert.equal(value.trips[0].payoutCents, 29100);
    assert.equal(value.trips[0].hasPending, false);
    assert.equal(value.reviewItems.length, 1);
    assert.equal(value.reviewItems[0].typeRaw, "Reversal");
    assert.equal(value.reviewItems[0].detail.reason, "reversal_without_refund");
  });

  test("amounts that do not reconcile keep both rows in review", () => {
    const badReversal = REVERSAL.replace("$97.00", "$100.00");
    const bad = parse([RESERVATION], [CHARGE, REFUND, badReversal]);
    assert.equal(bad.trips[0].payoutCents, 29100);
    assert.deepEqual(
      bad.reviewItems.map((item) => [item.typeRaw, item.detail.reason]),
      [
        ["Refund", "refund_reversal_mismatch"],
        ["Reversal", "refund_reversal_mismatch"],
      ]
    );

    const movingRefund = REFUND.replace(/\$0\.00,\$0\.00$/, "$0.00,$97.00");
    const moving = parse([RESERVATION], [CHARGE, movingRefund, REVERSAL]);
    assert.equal(moving.trips[0].payoutCents, 29100);
    assert.equal(moving.reviewItems.length, 2);

    const otherAmount = REVERSAL.replace("($100.00)", "($90.00)");
    const unmatched = parse([RESERVATION], [CHARGE, REFUND, otherAmount]);
    assert.deepEqual(
      unmatched.reviewItems.map((item) => item.detail.reason),
      ["refund_without_reversal", "reversal_without_refund"]
    );
  });

  test("an unparseable refund amount is parked as unparsed", () => {
    const value = parse([RESERVATION], [CHARGE, REFUND.replace("($100.00)", "abc"), REVERSAL]);
    assert.equal(value.trips[0].payoutCents, 29100);
    const reasons = value.reviewItems.map((item) => item.detail.reason).sort();
    assert.deepEqual(reasons, ["reversal_without_refund", "unparsed_amount_or_date"]);
  });

  test("re-importing the same files upserts one trip and leaves no review rows", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", {
      ownerId: 1,
      year: 2022,
      make: "Testmake",
      model: "Rio",
      color: "White",
      licensePlate: "TEST101",
      vin: "1TSTCAR0000000101",
    });
    assert.equal(created.status, 201, created.text);

    async function importAndCommit(transactionRows: string[]) {
      const form = new FormData();
      form.set("reservations", csvFile("booking-export.csv", [RESERVATIONS_HEADER, RESERVATION].join("\n")));
      form.set(
        "transactions",
        csvFile("transactions-export.csv", [TRANSACTIONS_HEADER, ...transactionRows].join("\n"))
      );
      const uploaded = await uploadImport(env, form);
      assert.equal(uploaded.status, 201, uploaded.text);
      const payload = uploaded.data as { import: { id: number }; reviewItems: unknown[] };
      const committed = await call(env, "POST", `/api/portal/admin/imports/${payload.import.id}/commit`);
      assert.equal(committed.status, 200, committed.text);
      return payload;
    }

    async function stored() {
      return requireDb(env)
        .prepare(
          `SELECT COUNT(*) AS n, MAX(payout_cents) AS payout, MAX(platform_fees_cents) AS fees
           FROM trips WHERE platform = 'wheelbase' AND external_trip_id = '91000001'`
        )
        .bind()
        .first<{ n: number; payout: number; fees: number }>();
    }

    // An earlier import that only had the charge rows.
    const before = await importAndCommit([CHARGE, WB_FEE]);
    assert.equal(before.reviewItems.length, 0);
    assert.equal(Number((await stored())?.payout), 28700);

    const first = await importAndCommit([CHARGE, WB_FEE, REFUND, REVERSAL]);
    assert.equal(first.reviewItems.length, 0);
    const second = await importAndCommit([CHARGE, WB_FEE, REFUND, REVERSAL]);
    assert.equal(second.reviewItems.length, 0);
    const row = await stored();
    assert.equal(Number(row?.n), 1);
    assert.equal(Number(row?.payout), 19000);
    assert.equal(Number(row?.fees), 1000);
  });
});
