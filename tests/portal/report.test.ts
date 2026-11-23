import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { insertLedgerEntry } from "../../lib/portal/db";
import type { PlatformMapper } from "../../lib/portal/import/types";
import { createImportPreview } from "../../lib/portal/import/service";
import { call, DEALER, devEnv, PANAMERICA, requireDb } from "./support";

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

const stubMapper: PlatformMapper = {
  platform: "stub",
  label: "Stub",
  canParse() {
    return false;
  },
  parse(input) {
    const text = input.file?.text ?? "";
    const lines = text.trim().split("\n").slice(1);
    return {
      ok: true,
      value: {
        trips: lines.map((line, index) => {
          const [externalTripId, vin, startDate, payout] = line.split(",");
          const payoutCents = Number(payout);
          return {
            rowNumber: index + 2,
            externalTripId,
            externalVehicleId: null,
            vin,
            plate: null,
            plateCandidates: [],
            startAt: `${startDate} 00:00:00`,
            endAt: null,
            startDate,
            endDate: startDate,
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

describe("net report", () => {
  test("subtracts expenses from income, keeps tax out, and ignores the ledger", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const preview = await createImportPreview(requireDb(env), 1, {
      platform: "stub",
      file: {
        filename: "stub.csv",
        text: "Stub ID,VIN,Start,Payout\nS1,1TSTCAR0000000001,2026-11-30,10000\nS2,1TSTCAR0000000001,2026-12-02,5000\n",
        bytes: 80,
      },
      reservations: null,
      transactions: null,
    }, [stubMapper]);
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal((await call(env, "POST", `/api/portal/admin/imports/${preview.payload.import.id}/commit`)).status, 200);
    await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, {
      entryDate: "2026-11-15",
      category: "cleaning",
      amountCents: 2500,
      note: "Wash",
    });
    await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, {
      entryDate: "2026-12-03",
      category: "fuel",
      amountCents: 1000,
      note: "Later",
    });
    await insertLedgerEntry(requireDb(env), carId, {
      entryDate: "2026-11-01",
      type: "trip_income",
      amountCents: 999999,
      note: "Old book",
    }, 1);

    const november = await call(env, "GET", `/api/portal/admin/cars/${carId}/report?month=2026-11`);
    const month = november.data?.monthTotals as {
      incomeCents: number;
      expenseCents: number;
      netCents: number;
    };
    const toDate = november.data?.toDate as { incomeCents: number; expenseCents: number; netCents: number };
    const allTime = november.data?.allTime as { incomeCents: number; netCents: number };
    assert.equal(month.incomeCents, 10000);
    assert.equal(month.expenseCents, 2500);
    assert.equal(month.netCents, 7500);
    assert.equal(toDate.incomeCents, 10000);
    assert.equal(toDate.expenseCents, 2500);
    assert.equal(toDate.netCents, 7500);
    assert.equal(allTime.incomeCents, 15000);
    assert.equal(allTime.netCents, 11500);
    assert.equal(JSON.stringify(november.data).includes("999999"), false);
    assert.equal(JSON.stringify(november.data).includes("Old book"), false);
    const december = await call(env, "GET", `/api/portal/admin/cars/${carId}/report?month=2026-12`);
    assert.equal((december.data?.monthTotals as { incomeCents: number }).incomeCents, 5000);
    const platforms = november.data?.platforms as { platform: string; incomeCents: number }[];
    assert.deepEqual(platforms, [{ platform: "stub", incomeCents: 10000, payoutCents: 10000, taxCents: null }]);
  });

  test("owners see only their cars and admin sees each car", async () => {
    const env = devEnv(PANAMERICA);
    const own = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const ownId = (own.data?.car as { id: number }).id;
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const other = await call(env, "POST", "/api/portal/admin/cars", carBody({
      ownerId: 2,
      licensePlate: "TEST009",
      vin: "9TSTCAR0000000009",
    }));
    const otherId = (other.data?.car as { id: number }).id;
    const dealer = { ...env, PORTAL_DEV_EMAIL: DEALER };
    assert.equal((await call(dealer, "GET", `/api/portal/cars/${otherId}/report?month=2026-11`)).status, 200);
    assert.equal((await call(dealer, "GET", `/api/portal/cars/${ownId}/report?month=2026-11`)).status, 404);
    assert.equal((await call(dealer, "GET", `/api/portal/admin/cars/${otherId}/report?month=2026-11`)).status, 403);
    assert.equal((await call(env, "GET", `/api/portal/admin/cars/${otherId}/report?month=2026-11`)).status, 200);
    assert.equal((await call(env, "GET", `/api/portal/admin/cars/${ownId}/report?month=2026-11`)).status, 200);
    const signedOut = await call({ DB: requireDb(env) }, "GET", `/api/portal/cars/${ownId}/report?month=2026-11`);
    assert.equal(signedOut.status, 401);
  });

  test("a trip that has trips blocks deleting the car", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const preview = await createImportPreview(requireDb(env), 1, {
      platform: "stub",
      file: {
        filename: "stub.csv",
        text: "Stub ID,VIN,Start,Payout\nS9,1TSTCAR0000000001,2026-11-01,100\n",
        bytes: 40,
      },
      reservations: null,
      transactions: null,
    }, [stubMapper]);
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    await call(env, "POST", `/api/portal/admin/imports/${preview.payload.import.id}/commit`);
    const blocked = await call(env, "DELETE", `/api/portal/admin/cars/${carId}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data?.reason, "car_has_trips");
  });
});
