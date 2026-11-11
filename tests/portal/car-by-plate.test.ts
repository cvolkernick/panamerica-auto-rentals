import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { carAdminHref, carIdFromAdminKey, normalizePlateKey, plateKeyFromPath } from "../../lib/portal/car-path";
import { insertCar } from "../../lib/portal/db";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { createMemoryD1 } from "./memory-d1";

const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";
const VIN_A = "1TSTCAR0000000001";
const VIN_B = "2TSTCAR0000000002";
const VIN_C = "3TSTCAR0000000003";

function devEnv(email: string): PortalEnv {
  return {
    DB: createMemoryD1(),
    PORTAL_DEV_AUTH: "1",
    PORTAL_DEV_EMAIL: email,
  };
}

async function call(env: PortalEnv, method: string, path: string, body?: unknown) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handlePortal(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env
  );
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    text,
  };
}

function carBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 1,
    year: 2024,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: "AB C-12",
    vin: VIN_A,
    ...overrides,
  };
}

describe("admin car page keys", () => {
  test("links encode the plate and use the id when the plate is blank", () => {
    assert.equal(normalizePlateKey(" ab c-12 "), "ABC12");
    assert.equal(carAdminHref({ id: 4, licensePlate: "AB C-12" }), "/admin/cars/AB%20C-12/");
    assert.equal(carAdminHref({ id: 4, licensePlate: "   " }), "/admin/cars/id-4/");
    assert.equal(plateKeyFromPath("/admin/cars/AB%20C-12/"), "AB C-12");
    assert.equal(plateKeyFromPath("/admin/cars/"), null);
    assert.equal(carIdFromAdminKey("id-12"), 12);
    assert.equal(carIdFromAdminKey("ID-12"), 12);
    assert.equal(carIdFromAdminKey("id-01"), null);
  });
});

describe("admin plate lookup", () => {
  test("matches a plate without case, spaces, or dashes, and 404s when it is missing", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    assert.equal(created.status, 201);
    const carId = (created.data?.car as { id: number }).id;
    const other = await call(
      env,
      "POST",
      "/api/portal/admin/cars",
      carBody({ licensePlate: "ZZ-9999", vin: VIN_B, color: "Blue" })
    );
    assert.equal(other.status, 201);

    for (const key of ["AB C-12", "ab c-12", "AB-C-12", "abc12", "  ab--c 12 "]) {
      const found = await call(
        env,
        "GET",
        `/api/portal/admin/cars/by-plate/${encodeURIComponent(key)}`
      );
      assert.equal(found.status, 200, key);
      const car = found.data?.car as { id: number; vin: string; ownerName?: string };
      assert.equal(car.id, carId);
      assert.equal(car.vin, VIN_A);
      assert.equal(car.ownerName, "Panamerica Auto Rentals");
      assert.equal(found.text.includes(VIN_B), false);
    }

    const sameKey = await call(env, "POST", "/api/portal/admin/cars", carBody({
      licensePlate: "ABC12",
      vin: VIN_C,
    }));
    assert.equal(sameKey.status, 201);
    const first = await call(env, "GET", "/api/portal/admin/cars/by-plate/abc12");
    assert.equal((first.data?.car as { vin: string }).vin, VIN_A);

    const missing = await call(env, "GET", "/api/portal/admin/cars/by-plate/NO-SUCH");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.data, { error: "car_not_found" });

    const blankKey = await call(
      env,
      "GET",
      `/api/portal/admin/cars/by-plate/${encodeURIComponent("---")}`
    );
    assert.equal(blankKey.status, 404);
    assert.deepEqual(blankKey.data, { error: "car_not_found" });

    const posted = await call(env, "POST", "/api/portal/admin/cars/by-plate/abc12", {});
    assert.equal(posted.status, 405);

    if (!env.DB) throw new Error("missing db");
    const blankId = await insertCar(env.DB, {
      ownerId: 1,
      year: 2020,
      make: "Blank",
      model: "Plate",
      color: "Red",
      licensePlate: "",
      vin: "4TSTCAR0000000004",
    });
    const byId = await call(env, "GET", `/api/portal/admin/cars/by-plate/id-${blankId}`);
    assert.equal(byId.status, 200);
    assert.equal((byId.data?.car as { make: string; licensePlate: string }).make, "Blank");
    assert.equal((byId.data?.car as { licensePlate: string }).licensePlate, "");

    const platedById = await call(env, "GET", `/api/portal/admin/cars/by-plate/ID-${carId}`);
    assert.equal(platedById.status, 200);
    assert.equal((platedById.data?.car as { vin: string }).vin, VIN_A);

    const missingId = await call(env, "GET", "/api/portal/admin/cars/by-plate/id-99999");
    assert.equal(missingId.status, 404);
    assert.deepEqual(missingId.data, { error: "car_not_found" });

    const spaces = await call(
      env,
      "GET",
      `/api/portal/admin/cars/by-plate/${encodeURIComponent("   ")}`
    );
    assert.equal(spaces.status, 404);
    assert.equal((spaces.data?.car as { id?: number } | undefined)?.id, undefined);
  });

  test("signed-out and non-admin requests stay behind the admin gate", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    assert.equal(created.status, 201);
    const path = "/api/portal/admin/cars/by-plate/abc12";

    const signedOut = await call({ DB: env.DB }, "GET", path);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.text.includes(VIN_A), false);
    assert.equal(signedOut.text.toLowerCase().includes("ab c-12"), false);

    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const dealerEnv: PortalEnv = { ...env, PORTAL_DEV_EMAIL: DEALER };
    const denied = await call(dealerEnv, "GET", path);
    assert.equal(denied.status, 403);
    assert.equal(denied.data?.reason, "not_admin");
    assert.equal(denied.text.includes(VIN_A), false);
    assert.equal(denied.text.toLowerCase().includes("ab c-12"), false);

    const ownerPath = await call(env, "GET", "/api/portal/cars/by-plate/abc12");
    assert.equal(ownerPath.status, 404);
    assert.equal(ownerPath.data?.error, "not_found");
    assert.equal(ownerPath.text.includes(VIN_A), false);
  });
});
