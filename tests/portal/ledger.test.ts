import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { randomToken, sha256Hex } from "../../lib/portal/codec";
import {
  deleteCar,
  getCarById,
  getLedgerEntry,
  insertCar,
  insertLedgerEntry,
  insertSession,
  listLedgerEntries,
  updateLedgerEntry,
} from "../../lib/portal/db";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import {
  LEDGER_TYPES,
  centsToDollarInput,
  currentMonthEastern,
  dollarsToCents,
  formatUsdFromCents,
  ledgerDirection,
  ledgerTotals,
  monthBounds,
  todayEastern,
  type LedgerType,
} from "../../lib/portal/ledger";
import { SESSION_COOKIE } from "../../lib/portal/session";
import type { LedgerWrite } from "../../lib/portal/validate";
import { createMemoryD1, loadMigrationSql } from "./memory-d1";

const PANAMERICA = "panamerica.cars@gmail.com";
const DEALER = "dealer.partner@example.com";
const VIN_A = "1TSTCAR0000000001";
const VIN_B = "2TSTCAR0000000002";

function devEnv(email: string, extra: Partial<PortalEnv> = {}): PortalEnv {
  return {
    DB: createMemoryD1(),
    PORTAL_DEV_AUTH: "1",
    PORTAL_DEV_EMAIL: email,
    ...extra,
  };
}

function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    origin?: string | null;
  } = {}
): Request {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://127.0.0.1");
  return new Request(`http://127.0.0.1${path}`, {
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
  headers?: Record<string, string>
) {
  const response = await handlePortal(request(method, path, { body, headers, origin: null }), env);
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

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    entryDate: "2026-11-02",
    type: "trip_income",
    amountCents: 124000,
    note: "Weekend trip",
    ...overrides,
  };
}

const sampleCar = {
  ownerId: 1,
  year: 2024,
  make: "Testmake",
  model: "Testmodel",
  color: "White",
  licensePlate: "TST-1001",
  vin: VIN_A,
};

describe("ledger migration", () => {
  test("creates the positive-amount ledger and does not insert rows", () => {
    const sql = loadMigrationSql("0004_car_ledger.sql");
    assert.match(sql, /CREATE TABLE car_ledger/);
    assert.match(sql, /REFERENCES cars \(id\) ON DELETE RESTRICT/);
    assert.match(sql, /REFERENCES owners \(id\) ON DELETE RESTRICT/);
    assert.match(sql, /amount_cents INTEGER NOT NULL CHECK \(amount_cents > 0\)/);
    assert.match(sql, /length\(note\) <= 200/);
    assert.match(sql, /idx_car_ledger_car_date ON car_ledger \(car_id, entry_date\)/);
    for (const type of LEDGER_TYPES) assert.match(sql, new RegExp(`'${type}'`));
    assert.doesNotMatch(sql, /INSERT\s+INTO/i);
  });
});

describe("ledger direction and totals", () => {
  test("only trip income is money in", () => {
    assert.equal(ledgerDirection("trip_income"), "income");
    for (const type of LEDGER_TYPES) {
      if (type === "trip_income") continue;
      assert.equal(ledgerDirection(type), "deduction");
    }
  });

  test("totals subtract every deduction from income", () => {
    const entries: { type: LedgerType; amountCents: number }[] = [
      { type: "trip_income", amountCents: 124000 },
      { type: "commission", amountCents: 18600 },
      { type: "maintenance", amountCents: 9550 },
      { type: "cleaning", amountCents: 4500 },
      { type: "tolls", amountCents: 1875 },
      { type: "insurance", amountCents: 21000 },
      { type: "payout", amountCents: 50000 },
      { type: "other", amountCents: 250 },
    ];
    assert.deepEqual(ledgerTotals(entries), {
      incomeCents: 124000,
      deductionCents: 105775,
      netCents: 18225,
    });
    assert.deepEqual(ledgerTotals([]), {
      incomeCents: 0,
      deductionCents: 0,
      netCents: 0,
    });
    assert.equal(
      ledgerTotals([{ type: "maintenance", amountCents: 4000 }]).netCents,
      -4000
    );
  });

  test("formats dollars and reads Eastern dates", () => {
    assert.equal(formatUsdFromCents(124000), "$1,240.00");
    assert.equal(formatUsdFromCents(50), "$0.50");
    assert.equal(formatUsdFromCents(0), "$0.00");
    assert.equal(formatUsdFromCents(-350), "-$3.50");
    assert.equal(dollarsToCents("125.50"), 12550);
    assert.equal(dollarsToCents("$1,240.00"), 124000);
    assert.equal(dollarsToCents("0.50"), 50);
    assert.equal(dollarsToCents("0"), null);
    assert.equal(dollarsToCents("0.00"), null);
    assert.equal(dollarsToCents("-5"), null);
    assert.equal(dollarsToCents("10.555"), null);
    assert.equal(centsToDollarInput(9550), "95.50");
    assert.deepEqual(monthBounds("2026-11"), { start: "2026-11-01", end: "2026-12-01" });
    assert.deepEqual(monthBounds("2026-12"), { start: "2026-12-01", end: "2027-01-01" });
    assert.equal(todayEastern(new Date("2026-01-15T04:30:00Z")), "2026-01-14");
    assert.equal(todayEastern(new Date("2026-07-15T03:30:00Z")), "2026-07-14");
    assert.equal(currentMonthEastern(new Date("2026-11-11T15:00:00Z")), "2026-11");
  });
});

describe("ledger database helpers", () => {
  test("stores positive cents and lists one car month at a time", async () => {
    const db = createMemoryD1();
    const carId = await insertCar(db, sampleCar);
    const otherId = await insertCar(db, {
      ...sampleCar,
      licensePlate: "TST-1002",
      vin: VIN_B,
      color: "Blue",
    });
    const income: LedgerWrite = {
      entryDate: "2026-11-02",
      type: "trip_income",
      amountCents: 124000,
      note: "Weekend trip",
    };
    const first = await insertLedgerEntry(db, carId, income, 1);
    const second = await insertLedgerEntry(
      db,
      carId,
      { entryDate: "2026-11-02", type: "commission", amountCents: 18600, note: null },
      1
    );
    await insertLedgerEntry(
      db,
      carId,
      { entryDate: "2026-11-30", type: "tolls", amountCents: 1875, note: "SunPass" },
      1
    );
    await insertLedgerEntry(
      db,
      carId,
      { entryDate: "2026-12-01", type: "trip_income", amountCents: 5000, note: "Next month" },
      1
    );
    await insertLedgerEntry(
      db,
      otherId,
      { entryDate: "2026-11-02", type: "cleaning", amountCents: 4500, note: "Other car" },
      1
    );

    const november = await listLedgerEntries(db, carId, monthBounds("2026-11"));
    assert.deepEqual(
      november.map((row) => [row.entry_date, row.type, row.id]),
      [
        ["2026-11-30", "tolls", second + 1],
        ["2026-11-02", "commission", second],
        ["2026-11-02", "trip_income", first],
      ]
    );
    assert.equal(
      november.some((row) => row.note === "Other car" || row.note === "Next month"),
      false
    );
    const stored = await getLedgerEntry(db, carId, first);
    assert.equal(stored?.amount_cents, 124000);
    assert.equal(stored?.created_by, 1);
    assert.equal(stored?.type, "trip_income");

    await updateLedgerEntry(db, carId, first, {
      ...income,
      amountCents: 100000,
      note: "Revised",
    });
    const revised = await getLedgerEntry(db, carId, first);
    assert.equal(revised?.amount_cents, 100000);
    assert.equal(revised?.note, "Revised");
    assert.equal(revised?.created_by, 1);
    assert.equal(await getLedgerEntry(db, otherId, first), null);

    await assert.rejects(() =>
      insertLedgerEntry(
        db,
        carId,
        { ...income, type: "rent" as LedgerType },
        1
      )
    );
    await assert.rejects(() =>
      insertLedgerEntry(db, carId, { ...income, amountCents: 0 }, 1)
    );
    await assert.rejects(() => insertLedgerEntry(db, 999, income, 1));
    await assert.rejects(() => deleteCar(db, carId));
    assert.ok(await getCarById(db, carId));

    const index = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_car_ledger_car_date'`
      )
      .bind()
      .first<{ name: string }>();
    assert.equal(index?.name, "idx_car_ledger_car_date");
  });
});

describe("ledger admin API", () => {
  test("an admin can add, filter, edit, and delete entries", async () => {
    const env = devEnv(PANAMERICA);
    const car = await call(env, "POST", "/api/portal/admin/cars", carBody());
    assert.equal(car.status, 201);
    const carId = (car.data?.car as { id: number }).id;
    const other = await call(
      env,
      "POST",
      "/api/portal/admin/cars",
      carBody({ vin: VIN_B, licensePlate: "TST-1002", color: "Blue" })
    );
    const otherId = (other.data?.car as { id: number }).id;

    const created = await call(env, "POST", `/api/portal/admin/cars/${carId}/ledger`, entryBody());
    assert.equal(created.status, 201);
    const entry = created.data?.entry as {
      id: number;
      carId: number;
      amountCents: number;
      createdBy: number;
      note: string;
      type: string;
    };
    assert.equal(entry.carId, carId);
    assert.equal(entry.amountCents, 124000);
    assert.equal(entry.createdBy, 1);
    assert.equal(entry.type, "trip_income");

    const longNote = "N".repeat(200);
    const commission = await call(
      env,
      "POST",
      `/api/portal/admin/cars/${carId}/ledger`,
      entryBody({ type: "commission", amountCents: 18600, note: longNote, entryDate: "2026-11-03" })
    );
    assert.equal(commission.status, 201);
    assert.equal((commission.data?.entry as { note: string }).note, longNote);

    await call(
      env,
      "POST",
      `/api/portal/admin/cars/${carId}/ledger`,
      entryBody({ type: "maintenance", amountCents: 9550, entryDate: "2026-12-01", note: "December" })
    );
    await call(
      env,
      "POST",
      `/api/portal/admin/cars/${otherId}/ledger`,
      entryBody({ type: "cleaning", amountCents: 4500, note: "Hidden car" })
    );

    const month = await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger?month=2026-11`);
    assert.equal(month.status, 200);
    const rows = month.data?.entries as { note: string | null; type: string; amountCents: number }[];
    assert.deepEqual(
      rows.map((row) => row.type),
      ["commission", "trip_income"]
    );
    assert.equal(month.text.includes("December"), false);
    assert.equal(month.text.includes("Hidden car"), false);
    assert.deepEqual(
      month.data?.totals,
      ledgerTotals(rows.map((row) => ({ type: row.type as LedgerType, amountCents: row.amountCents })))
    );
    assert.deepEqual(month.data?.totals, {
      incomeCents: 124000,
      deductionCents: 18600,
      netCents: 105400,
    });

    const all = await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger`);
    assert.equal((all.data?.entries as unknown[]).length, 3);
    assert.equal(all.data?.month, null);

    const edited = await call(env, "PATCH", `/api/portal/admin/cars/${carId}/ledger/${entry.id}`, {
      amountCents: 100000,
      note: " x'); DROP TABLE car_ledger;-- ",
    });
    assert.equal(edited.status, 200);
    const editedEntry = edited.data?.entry as { amountCents: number; note: string; createdBy: number };
    assert.equal(editedEntry.amountCents, 100000);
    assert.equal(editedEntry.note, "x'); DROP TABLE car_ledger;--");
    assert.equal(editedEntry.createdBy, 1);
    const stillThere = await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger?month=2026-11`);
    assert.equal((stillThere.data?.entries as unknown[]).length, 2);

    const wrongCar = await call(env, "PATCH", `/api/portal/admin/cars/${otherId}/ledger/${entry.id}`, {
      note: "Moved",
    });
    assert.equal(wrongCar.status, 404);

    const removed = await call(env, "DELETE", `/api/portal/admin/cars/${carId}/ledger/${entry.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data, { ok: true });
    assert.equal(
      (await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger/${entry.id}`)).status,
      405
    );
    assert.equal(
      (await call(env, "DELETE", `/api/portal/admin/cars/${carId}/ledger/${entry.id}`)).status,
      404
    );

    const blocked = await call(env, "DELETE", `/api/portal/admin/cars/${carId}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data?.reason, "car_has_ledger");
    assert.equal((await call(env, "GET", `/api/portal/admin/cars/${carId}`)).status, 200);
  });

  test("bad ledger input is a 4xx and a non-admin is rejected", async () => {
    const env = devEnv(PANAMERICA);
    const car = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (car.data?.car as { id: number }).id;
    const cases: Record<string, unknown>[] = [
      entryBody({ entryDate: "2026-02-31" }),
      entryBody({ entryDate: "2025-02-29" }),
      entryBody({ entryDate: "11/02/2026" }),
      entryBody({ entryDate: "1979-11-02" }),
      entryBody({ type: "rent" }),
      entryBody({ amountCents: 0 }),
      entryBody({ amountCents: -100 }),
      entryBody({ amountCents: 10.5 }),
      entryBody({ amountCents: "12.50" }),
      entryBody({ note: "N".repeat(201) }),
      entryBody({ note: "bad\u0000note" }),
      {},
    ];
    for (const body of cases) {
      const result = await call(env, "POST", `/api/portal/admin/cars/${carId}/ledger`, body);
      assert.equal(result.status >= 400 && result.status < 500, true, JSON.stringify(body));
      assert.equal(result.data?.error === "server_error", false);
      assert.equal(/SQLITE/i.test(result.text), false);
    }
    const leap = await call(
      env,
      "POST",
      `/api/portal/admin/cars/${carId}/ledger`,
      entryBody({ entryDate: "2024-02-29", amountCents: "2500" })
    );
    assert.equal(leap.status, 201);

    const blankNote = await call(
      env,
      "POST",
      `/api/portal/admin/cars/${carId}/ledger`,
      entryBody({ note: "   ", entryDate: "2026-11-04" })
    );
    assert.equal(blankNote.status, 201);
    assert.equal((blankNote.data?.entry as { note: string | null }).note, null);

    const badMonth = await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger?month=2026-13`);
    assert.equal(badMonth.status, 400);
    assert.equal((badMonth.data?.fields as { month: string }).month.includes("YYYY-MM"), true);
    const shortMonth = await call(env, "GET", `/api/portal/admin/cars/${carId}/ledger?month=2026-1`);
    assert.equal(shortMonth.status, 400);

    const missingCar = await call(env, "POST", "/api/portal/admin/cars/999/ledger", entryBody());
    assert.equal(missingCar.status, 404);
    const brokenResponse = await handlePortal(
      new Request(`http://127.0.0.1/api/portal/admin/cars/${carId}/ledger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      env
    );
    const brokenText = await brokenResponse.text();
    assert.equal(brokenResponse.status, 400);
    assert.equal((JSON.parse(brokenText) as { error?: string }).error, "invalid_json");
    const emptyPatch = await call(
      env,
      "PATCH",
      `/api/portal/admin/cars/${carId}/ledger/${(leap.data?.entry as { id: number }).id}`,
      {}
    );
    assert.equal(emptyPatch.status, 400);

    const created = await call(env, "POST", `/api/portal/admin/cars/${carId}/ledger`, entryBody({
      note: "Private toll",
      entryDate: "2026-11-08",
    }));
    const entryId = (created.data?.entry as { id: number }).id;
    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const dealerEnv: PortalEnv = { ...env, PORTAL_DEV_EMAIL: DEALER };
    for (const [method, path] of [
      ["GET", `/api/portal/admin/cars/${carId}/ledger`],
      ["POST", `/api/portal/admin/cars/${carId}/ledger`],
      ["PATCH", `/api/portal/admin/cars/${carId}/ledger/${entryId}`],
      ["DELETE", `/api/portal/admin/cars/${carId}/ledger/${entryId}`],
    ] as const) {
      const denied = await call(dealerEnv, method, path, method === "GET" ? undefined : entryBody());
      assert.equal(denied.status, 403);
      assert.equal(denied.data?.reason, "not_admin");
      assert.equal(denied.text.includes("Private toll"), false);
    }

    const signedOut = await call({ DB: env.DB }, "GET", `/api/portal/admin/cars/${carId}/ledger`);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.text.includes("Private toll"), false);

    const ownerPath = await call(env, "GET", `/api/portal/cars/${carId}/ledger`);
    assert.equal(ownerPath.status, 404);
    assert.equal(ownerPath.text.includes("Private toll"), false);
  });

  test("a real admin session still has to send the CSRF token", async () => {
    const db = createMemoryD1();
    const carId = await insertCar(db, sampleCar);
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
    const env: PortalEnv = { DB: db };
    const cookie = `${SESSION_COOKIE}=${token}`;
    const path = `/api/portal/admin/cars/${carId}/ledger`;

    const wrong = await handlePortal(
      request("POST", path, {
        body: entryBody(),
        headers: { cookie, "x-csrf-token": "wrong" },
      }),
      env
    );
    assert.equal(wrong.status, 403);
    assert.equal(((await wrong.json()) as { reason?: string }).reason, "csrf");

    const accepted = await handlePortal(
      request("POST", path, {
        body: entryBody(),
        headers: { cookie, "x-csrf-token": csrf },
      }),
      env
    );
    assert.equal(accepted.status, 201);
  });
});

describe("ledger admin view", () => {
  test("each car links to its own page and the ledger wraps long text", () => {
    const admin = readFileSync("app/admin/admin-portal.tsx", "utf8");
    const view = readFileSync("app/admin/car-ledger.tsx", "utf8");
    const page = readFileSync("app/admin/cars/car-admin.tsx", "utf8");
    const owner = readFileSync("app/owner/owner-portal.tsx", "utf8");
    assert.match(admin, />\s*Ledger\s*</);
    assert.match(admin, /carAdminHref/);
    assert.doesNotMatch(admin, /setLedgerCarId/);
    assert.doesNotMatch(admin, /<CarLedger/);
    assert.match(page, /<CarLedger/);
    assert.match(page, /window\.location\.pathname/);
    assert.match(page, /history\.replaceState/);
    assert.match(page, /Car not found/);
    assert.match(view, /min-w-0/);
    assert.match(view, /wrap-anywhere/);
    assert.match(view, /overflow-hidden/);
    assert.match(view, /Delete this ledger entry\?/);
    assert.match(view, /dollarsToCents/);
    assert.match(view, /todayEastern/);
    assert.match(view, /Income/);
    assert.match(view, /Deductions/);
    assert.match(view, /Net/);
    assert.doesNotMatch(owner, /\/ledger/);
    assert.doesNotMatch(owner, /CarLedger/);
  });
});
