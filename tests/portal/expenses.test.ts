import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { call, DEALER, devEnv, PANAMERICA } from "./support";

function carBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 1,
    year: 2024,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: "TST-1001",
    vin: "1TSTCAR0000000001",
    ...overrides,
  };
}

function expenseBody(overrides: Record<string, unknown> = {}) {
  return {
    entryDate: "2026-11-02",
    category: "maintenance",
    amountCents: 9550,
    note: "Brake pads",
    ...overrides,
  };
}

describe("expenses", () => {
  test("admin can create, edit, and delete, and a car with expenses cannot be deleted", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const posted = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, expenseBody());
    assert.equal(posted.status, 201);
    const expense = posted.data?.expense as { id: number; amountCents: number; note: string };
    assert.equal(expense.amountCents, 9550);

    const edited = await call(env, "PATCH", `/api/portal/admin/cars/${carId}/expenses/${expense.id}`, {
      amountCents: 10000,
      note: "Brake pads and fluid",
    });
    assert.equal(edited.status, 200);
    assert.equal((edited.data?.expense as { amountCents: number }).amountCents, 10000);

    const month = await call(env, "GET", `/api/portal/admin/cars/${carId}/expenses?month=2026-11`);
    assert.equal(month.status, 200);
    assert.equal((month.data?.expenses as unknown[]).length, 1);

    const blocked = await call(env, "DELETE", `/api/portal/admin/cars/${carId}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data?.reason, "car_has_expenses");

    const removed = await call(env, "DELETE", `/api/portal/admin/cars/${carId}/expenses/${expense.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await call(env, "DELETE", `/api/portal/admin/cars/${carId}/expenses/${expense.id}`)).status, 404);
    assert.equal((await call(env, "DELETE", `/api/portal/admin/cars/${carId}`)).status, 200);
  });

  test("rejects bad category, amount, date, and note length", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const cases = [
      expenseBody({ category: "trip_income" }),
      expenseBody({ amountCents: 0 }),
      expenseBody({ amountCents: -5 }),
      expenseBody({ entryDate: "2026-02-31" }),
      expenseBody({ note: "x".repeat(201) }),
    ];
    for (const body of cases) {
      const result = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, body);
      assert.equal(result.status, 400, JSON.stringify(body));
    }
    const ok = await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, expenseBody({
      note: "x".repeat(200),
      category: "fuel",
    }));
    assert.equal(ok.status, 201);
  });

  test("an owner can read expenses and cannot write them", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    await call(env, "POST", `/api/portal/admin/cars/${carId}/expenses`, expenseBody({ note: "Owner visible" }));
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const other = await call(env, "POST", "/api/portal/admin/cars", carBody({
      ownerId: 2,
      licensePlate: "TST-1002",
      vin: "2TSTCAR0000000002",
    }));
    const otherId = (other.data?.car as { id: number }).id;
    const dealer: typeof env = { ...env, PORTAL_DEV_EMAIL: DEALER };

    const own = await call(dealer, "GET", `/api/portal/cars/${otherId}/expenses?month=2026-11`);
    assert.equal(own.status, 200);
    const hidden = await call(dealer, "GET", `/api/portal/cars/${carId}/expenses`);
    assert.equal(hidden.status, 404);
    const ownerWrite = await call(dealer, "POST", `/api/portal/cars/${otherId}/expenses`, expenseBody());
    assert.equal(ownerWrite.status, 404);
    const adminWrite = await call(dealer, "POST", `/api/portal/admin/cars/${otherId}/expenses`, expenseBody());
    assert.equal(adminWrite.status, 403);
    const adminRead = await call(dealer, "GET", `/api/portal/admin/cars/${otherId}/expenses`);
    assert.equal(adminRead.status, 403);

    const readable = await call(env, "GET", `/api/portal/cars/${carId}/expenses`);
    assert.equal(readable.status, 200);
    assert.equal((readable.data?.expenses as { note: string }[])[0].note, "Owner visible");
  });
});
