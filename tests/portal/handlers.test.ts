import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { generateKeyPair, SignJWT, exportJWK, type CryptoKey } from "jose";

import { clearAccessJwksCache } from "../../lib/portal/access";
import { OWNER_CAR_BY_ID_SQL, OWNER_CARS_SQL } from "../../lib/portal/db";
import { handlePortal, type PortalDeps } from "../../lib/portal/handler";
import type { PortalEnv } from "../../lib/portal/env";
import { maxCarYear } from "../../lib/portal/validate";
import { onRequest } from "../../functions/api/portal/[[path]]";
import { createMemoryD1, loadMigrationSql } from "./memory-d1";

const TEAM = "panamerica.cloudflareaccess.com";
const AUD = "portal-aud-tag";
const ISSUER = `https://${TEAM}`;
const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";
const VIN_A = "1TSTCAR0000000001";
const VIN_B = "2TSTCAR0000000002";

let publicKey: CryptoKey;
let privateKey: CryptoKey;

before(async () => {
  const keys = await generateKeyPair("RS256");
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
});

function devEnv(email: string, extra: Partial<PortalEnv> = {}): PortalEnv {
  return {
    DB: createMemoryD1(),
    PORTAL_DEV_AUTH: "1",
    PORTAL_DEV_EMAIL: email,
    ...extra,
  };
}

function accessEnv(extra: Partial<PortalEnv> = {}): PortalEnv {
  return {
    DB: createMemoryD1(),
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUD,
    ...extra,
  };
}

function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    host?: string;
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.token) headers.set("cf-access-jwt-assertion", options.token);
  return new Request(`${options.host ?? "http://127.0.0.1"}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function call(
  env: PortalEnv,
  method: string,
  path: string,
  body?: unknown,
  deps?: PortalDeps,
  host?: string,
  token?: string
) {
  const response = await handlePortal(
    request(method, path, { body, host, token }),
    env,
    deps
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
    licensePlate: "TST-1001",
    vin: VIN_A,
    ...overrides,
  };
}

async function tokenFor(
  email: string,
  overrides: {
    audience?: string | string[];
    issuer?: string;
    expiresIn?: string | number;
    emailClaim?: unknown;
    omitEmail?: boolean;
    key?: CryptoKey;
  } = {}
) {
  const claims: Record<string, unknown> = {};
  if (!overrides.omitEmail) {
    claims.email = overrides.emailClaim === undefined ? email : overrides.emailClaim;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUD)
    .setSubject("user-test")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "10m")
    .sign(overrides.key ?? privateKey);
}

describe("migration seed", () => {
  test("seeds only the Panamerica owner and no cars", async () => {
    const sql = loadMigrationSql();
    assert.match(sql, /Panamerica Auto Rentals/);
    assert.match(sql, /panamerica\.cars@gmail\.com/);
    assert.match(sql, /is_admin/);
    assert.doesNotMatch(sql, /INSERT INTO cars/i);
    assert.equal(sql.match(/INSERT INTO owners/gi)?.length, 1);

    const env = devEnv(PANAMERICA);
    const session = await call(env, "GET", "/api/portal/session");
    assert.equal(session.status, 200);
    const owner = session.data?.owner as { name: string; email: string; isAdmin: boolean };
    assert.equal(owner.name, "Panamerica Auto Rentals");
    assert.equal(owner.email, PANAMERICA);
    assert.equal(owner.isAdmin, true);

    const cars = await call(env, "GET", "/api/portal/cars");
    assert.equal(cars.status, 200);
    assert.deepEqual(cars.data?.cars, []);
  });

  test("owner car SQL always filters by owner id", () => {
    assert.match(OWNER_CARS_SQL, /WHERE owner_id = \?/);
    assert.match(OWNER_CAR_BY_ID_SQL, /WHERE id = \? AND owner_id = \?/);
    assert.doesNotMatch(OWNER_CAR_BY_ID_SQL, /SELECT \*/);
  });
});

describe("auth mapping", () => {
  test("a valid Access JWT maps to the seeded owner", async () => {
    const env = accessEnv();
    const token = await tokenFor(PANAMERICA);
    const result = await call(env, "GET", "/api/portal/session", undefined, { jwtKey: publicKey }, undefined, token);
    assert.equal(result.status, 200);
    assert.equal((result.data?.owner as { email: string }).email, PANAMERICA);
    assert.equal(result.data?.email, PANAMERICA);
  });

  test("JWT email case still maps to the owner row", async () => {
    const env = accessEnv();
    const token = await tokenFor(PANAMERICA, { emailClaim: "Panamerica.Cars@gmail.com" });
    const result = await call(env, "GET", "/api/portal/session", undefined, { jwtKey: publicKey }, undefined, token);
    assert.equal(result.status, 200);
    assert.equal(result.data?.email, PANAMERICA);
  });

  test("an unknown email with a valid JWT gets 403 and no car data", async () => {
    const env = accessEnv();
    const token = await tokenFor("stranger@example.com");
    const result = await call(env, "GET", "/api/portal/cars", undefined, { jwtKey: publicKey }, undefined, token);
    assert.equal(result.status, 403);
    assert.equal(result.data?.reason, "unknown_email");
    assert.equal(result.data?.email, "stranger@example.com");
    assert.equal(result.text.includes(VIN_A), false);
    assert.equal("cars" in (result.data ?? {}), false);
  });

  test("missing, expired, wrong-audience, and bad-signature tokens are 401", async () => {
    const env = accessEnv();
    const missing = await call(env, "GET", "/api/portal/session", undefined, { jwtKey: publicKey });
    assert.equal(missing.status, 401);

    const expired = await call(
      env,
      "GET",
      "/api/portal/session",
      undefined,
      { jwtKey: publicKey },
      undefined,
      await tokenFor(PANAMERICA, { expiresIn: "-10m" })
    );
    assert.equal(expired.status, 401);

    const wrongAud = await call(
      env,
      "GET",
      "/api/portal/session",
      undefined,
      { jwtKey: publicKey },
      undefined,
      await tokenFor(PANAMERICA, { audience: "other-aud" })
    );
    assert.equal(wrongAud.status, 401);

    const other = await generateKeyPair("RS256");
    const badSig = await call(
      env,
      "GET",
      "/api/portal/session",
      undefined,
      { jwtKey: publicKey },
      undefined,
      await tokenFor(PANAMERICA, { key: other.privateKey })
    );
    assert.equal(badSig.status, 401);

    const noEmail = await call(
      env,
      "GET",
      "/api/portal/session",
      undefined,
      { jwtKey: publicKey },
      undefined,
      await tokenFor(PANAMERICA, { omitEmail: true })
    );
    assert.equal(noEmail.status, 401);
  });

  test("Access certs are fetched from the team domain when no test key is injected", async () => {
    const jwk = await exportJWK(publicKey);
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwk.kid = "test-kid";
    const original = globalThis.fetch;
    let requested = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requested = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      clearAccessJwksCache();
      const env = accessEnv({ CF_ACCESS_TEAM_DOMAIN: "https://jwks-test.cloudflareaccess.com" });
      const signed = await new SignJWT({ email: PANAMERICA })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
        .setIssuer("https://jwks-test.cloudflareaccess.com")
        .setAudience(AUD)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
      const response = await handlePortal(
        request("GET", "/api/portal/session", { token: signed }),
        env
      );
      assert.equal(response.status, 200);
      assert.equal(requested, "https://jwks-test.cloudflareaccess.com/cdn-cgi/access/certs");
    } finally {
      globalThis.fetch = original;
      clearAccessJwksCache();
    }
  });

  test("dev bypass is off unless the flag is exactly 1 and the host is local", async () => {
    const withEmailOnly = accessEnv({ PORTAL_DEV_EMAIL: PANAMERICA });
    assert.equal((await call(withEmailOnly, "GET", "/api/portal/session")).status, 401);

    assert.equal(
      (await call({ ...devEnv(PANAMERICA), PORTAL_DEV_AUTH: "true" }, "GET", "/api/portal/session")).status,
      401
    );

    const production = await call(
      devEnv(PANAMERICA),
      "GET",
      "/api/portal/session",
      undefined,
      undefined,
      "https://www.panamericafleet.com"
    );
    assert.equal(production.status, 401);
    assert.equal(production.data?.reason, "access_not_configured");

    const pages = await call(
      devEnv(PANAMERICA),
      "GET",
      "/api/portal/session",
      undefined,
      undefined,
      "https://panamerica.pages.dev"
    );
    assert.equal(pages.status, 401);

    const local = await call(devEnv(PANAMERICA), "GET", "/api/portal/session");
    assert.equal(local.status, 200);
  });

  test("on a locked host a real JWT still works when the dev flag is set", async () => {
    const env = accessEnv({ PORTAL_DEV_AUTH: "1", PORTAL_DEV_EMAIL: DEALER });
    const token = await tokenFor(PANAMERICA);
    const result = await call(
      env,
      "GET",
      "/api/portal/session",
      undefined,
      { jwtKey: publicKey },
      "https://www.panamericafleet.com",
      token
    );
    assert.equal(result.status, 200);
    assert.equal(result.data?.email, PANAMERICA);
  });

  test("the Pages function delegates to the portal handler", async () => {
    const env = devEnv(PANAMERICA);
    const response = await onRequest({
      request: request("GET", "/api/portal/session"),
      env,
    });
    assert.equal(response.status, 200);
  });
});

describe("tenant isolation", () => {
  test("an owner cannot read another owner's car by id or by list", async () => {
    const env = devEnv(PANAMERICA);
    const createdOwner = await call(env, "POST", "/api/portal/admin/owners", {
      name: "Dealer Partner",
      email: DEALER,
    });
    assert.equal(createdOwner.status, 201);
    const dealerId = (createdOwner.data?.owner as { id: number }).id;

    const panamericaCar = await call(env, "POST", "/api/portal/admin/cars", carBody());
    assert.equal(panamericaCar.status, 201);
    const panamericaId = (panamericaCar.data?.car as { id: number }).id;

    const dealerCar = await call(
      env,
      "POST",
      "/api/portal/admin/cars",
      carBody({
        ownerId: dealerId,
        licensePlate: "TST-1002",
        vin: VIN_B,
        color: "Blue",
      })
    );
    assert.equal(dealerCar.status, 201);

    const dealerEnv: PortalEnv = { ...env, PORTAL_DEV_EMAIL: DEALER };
    const list = await call(dealerEnv, "GET", `/api/portal/cars?owner_id=${panamericaId}`);
    assert.equal(list.status, 200);
    const listed = list.data?.cars as { vin: string }[];
    assert.deepEqual(listed.map((car) => car.vin), [VIN_B]);

    const stolen = await call(dealerEnv, "GET", `/api/portal/cars/${panamericaId}`);
    assert.equal(stolen.status, 404);
    assert.deepEqual(stolen.data, { error: "not_found" });
    assert.equal(stolen.text.includes(VIN_A), false);

    const adminAsDealer = await call(dealerEnv, "GET", "/api/portal/admin/cars");
    assert.equal(adminAsDealer.status, 403);
    assert.equal(adminAsDealer.data?.reason, "not_admin");
    assert.equal(adminAsDealer.text.includes(VIN_A), false);

    const ownList = await call(env, "GET", "/api/portal/cars");
    assert.deepEqual((ownList.data?.cars as { vin: string }[]).map((car) => car.vin), [VIN_A]);

    const everyone = await call(env, "GET", "/api/portal/admin/cars");
    assert.equal((everyone.data?.cars as unknown[]).length, 2);

    const dropped = await call(dealerEnv, "DELETE", `/api/portal/cars/${panamericaId}`);
    assert.equal(dropped.status, 405);
    const stillThere = await call(env, "GET", `/api/portal/cars/${panamericaId}`);
    assert.equal(stillThere.status, 200);
  });
});

describe("validation and CRUD", () => {
  test("rejects a bad VIN, a bad year, and duplicate VIN or email", async () => {
    const env = devEnv(PANAMERICA);
    const badVin = await call(env, "POST", "/api/portal/admin/cars", carBody({ vin: "1TSTCAR00000000I1" }));
    assert.equal(badVin.status, 400);
    assert.equal((badVin.data?.fields as { vin: string }).vin.includes("I, O, or Q"), true);

    const max = maxCarYear();
    const badYear = await call(env, "POST", "/api/portal/admin/cars", carBody({ year: max + 1, vin: VIN_B }));
    assert.equal(badYear.status, 400);
    assert.match((badYear.data?.fields as { year: string }).year, /Year must be a whole number/);

    const edge = await call(env, "POST", "/api/portal/admin/cars", carBody({ year: max, vin: VIN_A }));
    assert.equal(edge.status, 201);

    const duplicate = await call(env, "POST", "/api/portal/admin/cars", carBody({ licensePlate: "TST-1002" }));
    assert.equal(duplicate.status, 409);

    const duplicateOwner = await call(env, "POST", "/api/portal/admin/owners", {
      name: "Again",
      email: "Panamerica.Cars@gmail.com",
    });
    assert.equal(duplicateOwner.status, 409);

    const missingOwner = await call(env, "POST", "/api/portal/admin/cars", carBody({ ownerId: 999, vin: VIN_B, licensePlate: "TST-1009" }));
    assert.equal(missingOwner.status, 400);
    assert.equal((missingOwner.data?.fields as { ownerId: string }).ownerId, "Owner not found.");
  });

  test("admin can add and edit owners, assign cars, and delete them", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/owners", {
      name: "Dealer Partner",
      email: DEALER,
      storedAdmin: false,
    });
    assert.equal(created.status, 201);
    const dealerId = (created.data?.owner as { id: number; isAdmin: boolean }).id;
    assert.equal((created.data?.owner as { isAdmin: boolean }).isAdmin, false);

    const renamed = await call(env, "PATCH", `/api/portal/admin/owners/${dealerId}`, {
      name: "Dealer Partner Cars",
    });
    assert.equal(renamed.status, 200);
    assert.equal((renamed.data?.owner as { name: string }).name, "Dealer Partner Cars");

    const demoteLast = await call(env, "PATCH", "/api/portal/admin/owners/1", { storedAdmin: false });
    assert.equal(demoteLast.status, 400);

    const car = await call(
      env,
      "POST",
      "/api/portal/admin/cars",
      carBody({ ownerId: dealerId, make: "x'); DROP TABLE cars;--" })
    );
    assert.equal(car.status, 201);
    const carId = (car.data?.car as { id: number; make: string }).id;
    assert.equal((car.data?.car as { make: string }).make, "x'); DROP TABLE cars;--");

    const stillListed = await call(env, "GET", "/api/portal/admin/cars");
    assert.equal(stillListed.status, 200);

    const moved = await call(env, "PATCH", `/api/portal/admin/cars/${carId}`, {
      ownerId: 1,
      color: "Silver",
      vin: "1tstcar0000000001",
    });
    assert.equal(moved.status, 200);
    const movedCar = moved.data?.car as { ownerId: number; color: string; vin: string };
    assert.equal(movedCar.ownerId, 1);
    assert.equal(movedCar.color, "Silver");
    assert.equal(movedCar.vin, VIN_A);

    const dealerEnv: PortalEnv = { ...env, PORTAL_DEV_EMAIL: DEALER };
    const dealerCars = await call(dealerEnv, "GET", "/api/portal/cars");
    assert.deepEqual(dealerCars.data?.cars, []);
    const mine = await call(env, "GET", "/api/portal/cars");
    assert.equal((mine.data?.cars as { id: number }[])[0].id, carId);

    const removed = await call(env, "DELETE", `/api/portal/admin/cars/${carId}`);
    assert.equal(removed.status, 200);
    assert.equal((await call(env, "GET", `/api/portal/cars/${carId}`)).status, 404);

    const secondAdmin = await call(env, "PATCH", `/api/portal/admin/owners/${dealerId}`, {
      storedAdmin: true,
    });
    assert.equal(secondAdmin.status, 200);
    const demoted = await call(env, "PATCH", "/api/portal/admin/owners/1", { storedAdmin: false });
    assert.equal(demoted.status, 200);
    assert.equal((demoted.data?.owner as { isAdmin: boolean }).isAdmin, false);
    const lockedOut = await call(env, "GET", "/api/portal/admin/owners");
    assert.equal(lockedOut.status, 403);

    const stranger = await call(
      {
        ...env,
        PORTAL_DEV_EMAIL: "stranger@example.com",
        ADMIN_EMAILS: "stranger@example.com",
      },
      "GET",
      "/api/portal/admin/owners"
    );
    assert.equal(stranger.status, 403);
    assert.equal(stranger.data?.reason, "unknown_email");

    const panamericaViaEnv = await call(
      { ...env, ADMIN_EMAILS: PANAMERICA },
      "GET",
      "/api/portal/admin/owners"
    );
    assert.equal(panamericaViaEnv.status, 200);
  });

  test("a non-admin cannot create owners or cars", async () => {
    const env = devEnv(PANAMERICA);
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const dealerEnv: PortalEnv = { ...env, PORTAL_DEV_EMAIL: DEALER };
    assert.equal((await call(dealerEnv, "POST", "/api/portal/admin/owners", { name: "Nope", email: "nope@example.com" })).status, 403);
    assert.equal((await call(dealerEnv, "POST", "/api/portal/admin/cars", carBody())).status, 403);
    assert.equal((await call(dealerEnv, "POST", "/api/portal/cars", carBody())).status, 405);
  });
});
