import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { randomToken, sha256Hex } from "../../lib/portal/codec";
import { insertSession } from "../../lib/portal/db";
import type { PortalD1 } from "../../lib/portal/d1";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { TURO_HEADERS } from "../../lib/portal/import/turo";
import {
  WHEELBASE_KNOWN_TYPES,
  wheelbaseMapper,
} from "../../lib/portal/import/wheelbase";
import { SESSION_COOKIE } from "../../lib/portal/session";
import { call, csvFile, devEnv, PANAMERICA, request, requireDb, uploadImport, DEALER } from "./support";
import { loadMigrationSql } from "./memory-d1";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function turoCsv(rows: Record<string, string>[]): string {
  return [
    TURO_HEADERS.join(","),
    ...rows.map((row) => TURO_HEADERS.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");
}

function turoRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Reservation ID": "T100",
    Guest: "Test Guest",
    Vehicle: "2022 Test Model 3 (TEST001)",
    "Vehicle name": "2022 Test Model 3",
    "Vehicle id": "10001",
    VIN: "1TSTCAR0000000001",
    "Trip start": "2026-11-01 11:00 AM",
    "Trip end": "2026-11-04 03:30 PM",
    "Pickup location": "123 Secret Street",
    "Return location": "123 Secret Street",
    "Trip status": "Completed",
    "Trip price": "$400.00",
    "Total earnings": "$380.00",
    ...overrides,
  };
}

function carBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 1,
    year: 2022,
    make: "Testmake",
    model: "Testmodel",
    color: "White",
    licensePlate: "TEST001",
    vin: "1TSTCAR0000000001",
    ...overrides,
  };
}

async function countTrips(db: PortalD1, platform: string, externalId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM trips WHERE platform = ? AND external_trip_id = ?`)
    .bind(platform, externalId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

type ImportPayload = {
  import: { id: number; status: string; counts: { matched: number; unmatched: number; ambiguous: number; invalid: number } };
  rows: {
    externalTripId: string | null;
    matchStatus: string;
    carId: number | null;
    error: string | null;
    plate: string | null;
    plateFallback: string | null;
    grossCents: number | null;
    platformFeesCents: number | null;
    payoutCents: number | null;
    taxCents: number | null;
    hasPending: boolean;
    countsAsIncome: boolean;
    id: number;
  }[];
  reviewItems: { kind: string; typeRaw: string | null; externalTripId: string | null; detail: Record<string, string> }[];
};

async function postCsv(env: PortalEnv, csv: string, platform = "turo") {
  const form = new FormData();
  form.set("platform", platform);
  form.set("file", csvFile("earnings.csv", csv));
  return uploadImport(env, form);
}

describe("trip import migration", () => {
  test("creates trips and expenses without inserting rows", () => {
    const sql = loadMigrationSql("0005_trips_expenses.sql");
    assert.match(sql, /CREATE TABLE trips/);
    assert.match(sql, /CREATE TABLE expenses/);
    assert.match(sql, /CREATE TABLE import_review_items/);
    assert.match(sql, /UNIQUE \(platform, external_trip_id\)/);
    assert.doesNotMatch(sql, /INSERT\s+INTO/i);
  });
});

describe("turo import", () => {
  test("matches VIN, plate, and a remembered vehicle id, and blocks commit", async () => {
    const env = devEnv(PANAMERICA);
    const carA = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carB = await call(env, "POST", "/api/portal/admin/cars", carBody({
      licensePlate: "TEST002",
      vin: "2TSTCAR0000000002",
      model: "Other",
    }));
    const idA = (carA.data?.car as { id: number }).id;
    const idB = (carB.data?.car as { id: number }).id;
    await requireDb(env).prepare(
      `INSERT INTO car_platform_ids (car_id, platform, external_vehicle_id, created_by) VALUES (?, 'turo', '555', 1)`
    )
      .bind(idA)
      .run();

    const vinHit = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "VINHIT",
        VIN: "2TSTCAR0000000002",
        Vehicle: "Wrong (TEST001)",
        "Vehicle id": "999",
      }),
    ]));
    assert.equal(vinHit.status, 201);
    const vinRow = (vinHit.data as ImportPayload).rows[0];
    assert.equal(vinRow.matchStatus, "matched");
    assert.equal(vinRow.carId, idB);

    const plateHit = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "PLATE",
        VIN: "",
        Vehicle: "Listing (TEST002)",
        "Vehicle id": "",
        "Vehicle name": "Testmodel",
      }),
    ]));
    assert.equal(((plateHit.data as ImportPayload).rows[0]).carId, idB);

    const remembered = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "REMEMBERED",
        "Vehicle id": "555",
        VIN: "2TSTCAR0000000002",
      }),
    ]));
    assert.equal(((remembered.data as ImportPayload).rows[0]).carId, idA);

    const unknownVin = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "UNKNOWNVIN",
        VIN: "3TSTCAR0000000003",
        Vehicle: "Listing (TEST001)",
      }),
    ]));
    const unknownRow = (unknownVin.data as ImportPayload).rows[0];
    assert.equal(unknownRow.matchStatus, "unmatched");
    assert.equal(unknownRow.error, "unknown_vin");
    assert.equal(unknownRow.carId, null);

    const nameOnly = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "NAMEONLY",
        VIN: "",
        "Vehicle id": "",
        Vehicle: "Testmodel",
        "Vehicle name": "Testmodel",
      }),
    ]));
    assert.equal((nameOnly.data as ImportPayload).rows[0].matchStatus, "unmatched");
    assert.equal(JSON.stringify(nameOnly.data).includes("Test Guest"), false);
    assert.equal(JSON.stringify(nameOnly.data).includes("Secret Street"), false);

    const blocked = await call(env, "POST", `/api/portal/admin/imports/${(unknownVin.data as ImportPayload).import.id}/commit`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data?.reason, "unresolved_rows");
    assert.equal(await countTrips(requireDb(env), "turo", "UNKNOWNVIN"), 0);
  });

  test("ambiguous plates stay in review until skipped or assigned", async () => {
    const env = devEnv(PANAMERICA);
    await call(env, "POST", "/api/portal/admin/cars", carBody({ licensePlate: "AB C-12", vin: "1TSTCAR0000000001" }));
    const second = await call(env, "POST", "/api/portal/admin/cars", carBody({
      licensePlate: "ABC12",
      vin: "2TSTCAR0000000002",
    }));
    const carId = (second.data?.car as { id: number }).id;
    const uploaded = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "AMBIG",
        VIN: "",
        "Vehicle id": "777",
        Vehicle: "Listing (ABC12)",
      }),
    ]));
    const payload = uploaded.data as ImportPayload;
    assert.equal(payload.rows[0].matchStatus, "ambiguous");
    const denied = await call(env, "POST", `/api/portal/admin/imports/${payload.import.id}/commit`);
    assert.equal(denied.status, 409);

    const assigned = await call(
      env,
      "POST",
      `/api/portal/admin/imports/${payload.import.id}/rows/${payload.rows[0].id}/match`,
      { carId }
    );
    assert.equal(assigned.status, 200);
    const remembered = await requireDb(env).prepare(
      `SELECT car_id FROM car_platform_ids WHERE platform = 'turo' AND external_vehicle_id = '777'`
    ).bind().first<{ car_id: number }>();
    assert.equal(Number(remembered?.car_id), carId);
    const committed = await call(env, "POST", `/api/portal/admin/imports/${payload.import.id}/commit`);
    assert.equal(committed.status, 200);
    assert.equal(await countTrips(requireDb(env), "turo", "AMBIG"), 1);
  });

  test("re-import updates the same trip and booked rows stay out of income until completed", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const first = await postCsv(env, turoCsv([
      turoRow({ "Reservation ID": "SAME", "Trip status": "Booked", "Total earnings": "$10.00", "Trip price": "$180.00" }),
    ]));
    assert.equal((first.data as ImportPayload).rows[0].countsAsIncome, false);
    assert.equal((await call(env, "POST", `/api/portal/admin/imports/${(first.data as ImportPayload).import.id}/commit`)).status, 200);

    const bookedReport = await call(env, "GET", `/api/portal/admin/cars/${carId}/report?month=2026-11`);
    const bookedTotals = (bookedReport.data?.monthTotals as { incomeCents: number });
    assert.equal(bookedTotals.incomeCents, 0);

    const second = await postCsv(env, turoCsv([
      turoRow({ "Reservation ID": "SAME", "Trip status": "Completed", "Total earnings": "$222.00", "Trip price": "$250.00" }),
    ]));
    assert.equal((await call(env, "POST", `/api/portal/admin/imports/${(second.data as ImportPayload).import.id}/commit`)).status, 200);
    assert.equal(await countTrips(requireDb(env), "turo", "SAME"), 1);
    const done = await call(env, "GET", `/api/portal/admin/cars/${carId}/report?month=2026-11`);
    assert.equal((done.data?.monthTotals as { incomeCents: number; payoutCents: number }).payoutCents, 22200);
    assert.equal((done.data?.monthTotals as { incomeCents: number }).incomeCents, 22200);
  });

  test("a non-zero cancellation counts and a zero cancellation does not", async () => {
    const env = devEnv(PANAMERICA);
    const created = await call(env, "POST", "/api/portal/admin/cars", carBody());
    const carId = (created.data?.car as { id: number }).id;
    const uploaded = await postCsv(env, turoCsv([
      turoRow({
        "Reservation ID": "FEE",
        "Trip status": "Guest cancellation",
        "Total earnings": "$15.50",
        "Trip start": "2026-11-02 09:00 AM",
      }),
      turoRow({
        "Reservation ID": "ZERO",
        "Trip status": "Host cancellation",
        "Total earnings": "$0.00",
        "Trip start": "2026-11-03 09:00 AM",
        VIN: "1TSTCAR0000000001",
      }),
    ]));
    const payload = uploaded.data as ImportPayload;
    assert.equal(payload.rows.find((row) => row.externalTripId === "FEE")?.countsAsIncome, true);
    assert.equal(payload.rows.find((row) => row.externalTripId === "ZERO")?.countsAsIncome, false);
    assert.equal((await call(env, "POST", `/api/portal/admin/imports/${payload.import.id}/commit`)).status, 200);
    const report = await call(env, "GET", `/api/portal/admin/cars/${carId}/report?month=2026-11`);
    assert.equal((report.data?.monthTotals as { incomeCents: number }).incomeCents, 1550);
  });
});

describe("wheelbase import", () => {
  test("joins the fixture files and parks the unknown type", async () => {
    const reservations = fixture("wheelbase_reservations_fixture.csv");
    const transactions = fixture("wheelbase_transactions_fixture.csv");
    const parsed = wheelbaseMapper.parse({
      reservations: { filename: "reservations.csv", text: reservations, bytes: reservations.length },
      transactions: { filename: "transactions.csv", text: transactions, bytes: transactions.length },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const byId = new Map(parsed.value.trips.map((trip) => [trip.externalTripId, trip]));
    const first = byId.get("90000001");
    const second = byId.get("90000002");
    const third = byId.get("90000003");
    assert.equal(first?.grossCents, 40000);
    assert.equal(first?.platformFeesCents, 1700);
    assert.equal(first?.payoutCents, 41900);
    assert.equal(first?.taxCents, 3600);
    assert.equal(first?.hasPending, false);
    assert.equal(second?.grossCents, 50000);
    assert.equal(second?.platformFeesCents, 2220);
    assert.equal(second?.payoutCents, 52530);
    assert.equal(second?.hasPending, true);
    assert.equal(second?.pendingPayoutCents, 23915);
    assert.equal(third?.plate, "Rio-TEST003");
    assert.deepEqual(third?.plateCandidates, ["RIOTEST003", "TEST003"]);
    assert.equal(third?.payoutCents, 21200);
    const legacy = parsed.value.reviewItems.find((item) => item.typeRaw === "Legacy Adjustment");
    assert.ok(legacy);
    assert.equal(legacy?.kind, "unknown_type");
    assert.equal(legacy?.externalTripId, "90000003");
    assert.equal((WHEELBASE_KNOWN_TYPES as readonly string[]).includes("Legacy Adjustment"), false);
    const encoded = JSON.stringify(parsed.value);
    assert.equal(encoded.includes("Test Guest"), false);
    assert.equal(encoded.includes("Test Agent"), false);

    const env = devEnv(PANAMERICA);
    const cars = [
      carBody(),
      carBody({ licensePlate: "TEST002", vin: "2TSTCAR0000000002", model: "Soul" }),
      carBody({ licensePlate: "TEST003", vin: "3TSTCAR0000000003", model: "Rio" }),
    ];
    const ids: number[] = [];
    for (const body of cars) {
      const created = await call(env, "POST", "/api/portal/admin/cars", body);
      ids.push((created.data?.car as { id: number }).id);
    }
    const form = new FormData();
    form.set("reservations", csvFile("wheelbase_reservations_fixture.csv", reservations));
    form.set("transactions", csvFile("wheelbase_transactions_fixture.csv", transactions));
    const uploaded = await uploadImport(env, form);
    assert.equal(uploaded.status, 201, uploaded.text);
    const payload = uploaded.data as ImportPayload;
    assert.equal(payload.rows.find((row) => row.externalTripId === "90000001")?.carId, ids[0]);
    assert.equal(payload.rows.find((row) => row.externalTripId === "90000002")?.hasPending, true);
    assert.equal(payload.rows.find((row) => row.externalTripId === "90000003")?.plateFallback, "TEST003");
    assert.equal(payload.rows.find((row) => row.externalTripId === "90000003")?.carId, ids[2]);
    assert.equal(payload.rows.find((row) => row.externalTripId === "90000003")?.payoutCents, 21200);
    assert.equal(
      payload.reviewItems.some((item) => item.typeRaw === "Legacy Adjustment"),
      true
    );
    assert.equal(uploaded.text.includes("Test Guest"), false);
    const committed = await call(env, "POST", `/api/portal/admin/imports/${payload.import.id}/commit`);
    assert.equal(committed.status, 200);
    const stored = await requireDb(env).prepare(
      `SELECT gross_cents, platform_fees_cents, payout_cents, tax_cents, has_pending
       FROM trips WHERE platform = 'wheelbase' AND external_trip_id = '90000002'`
    ).bind().first<{
      gross_cents: number;
      platform_fees_cents: number;
      payout_cents: number;
      tax_cents: number;
      has_pending: number;
    }>();
    assert.equal(Number(stored?.gross_cents), 50000);
    assert.equal(Number(stored?.platform_fees_cents), 2220);
    assert.equal(Number(stored?.payout_cents), 52530);
    assert.equal(Number(stored?.has_pending), 1);
    const report = await call(env, "GET", `/api/portal/admin/cars/${ids[0]}/report?month=2026-11`);
    const totals = report.data?.monthTotals as {
      payoutCents: number;
      taxCents: number;
      incomeCents: number;
      grossCents: number;
      platformFeesCents: number;
    };
    assert.equal(totals.grossCents, 40000);
    assert.equal(totals.platformFeesCents, 1700);
    assert.equal(totals.payoutCents, 41900);
    assert.equal(totals.taxCents, 3600);
    assert.equal(totals.incomeCents, 38300);
    const reviewLeft = await requireDb(env).prepare(
      `SELECT detail FROM import_review_items WHERE type_raw = 'Legacy Adjustment'`
    ).bind().first<{ detail: string }>();
    assert.match(reviewLeft?.detail ?? "", /Legacy Adjustment|Type/);
    assert.equal((reviewLeft?.detail ?? "").includes("Test Guest"), false);
  });

  test("parks unmatched booking ids and fails closed on bad headers", async () => {
    const reservations = [
      "Booking ID,Status,Vehicle Internal ID,Start,End,Start Time,End Time,Subtotal",
      "90000050,Returned,TEST001,2026-11-01,2026-11-02,0,0,10.00",
      "90000051,Returned,TEST001,2026-11-03,2026-11-04,0,0,20.00",
    ].join("\n");
    const transactions = [
      "Date,Deposit Date,Reservation,Type,Amount,CC Fee,Wheelbase Fee,Credit,Debit",
      "2026-11-03,2026-11-04,#90000051 - Test Guest,Full Reservation Charge,$20.00,$1.00,$0.00,$19.00,$0.00",
      "2026-11-05,2026-11-06,#90000052 - Test Guest,Full Reservation Charge,$8.00,$0.00,$0.00,$8.00,$0.00",
    ].join("\n");
    const parsed = wheelbaseMapper.parse({
      reservations: { filename: "r.csv", text: reservations, bytes: reservations.length },
      transactions: { filename: "t.csv", text: transactions, bytes: transactions.length },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.trips.length, 1);
    assert.equal(parsed.value.trips[0].externalTripId, "90000051");
    const parked = parsed.value.reviewItems.map((item) => item.externalTripId).sort();
    assert.deepEqual(parked, ["90000050", "90000052"]);
    assert.equal(JSON.stringify(parsed.value).includes("Test Guest"), false);

    const missing = wheelbaseMapper.parse({
      reservations: { filename: "r.csv", text: "Booking ID,Status\n1,Returned\n", bytes: 10 },
      transactions: { filename: "t.csv", text: transactions, bytes: transactions.length },
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /Subtotal/);

    const env = devEnv(PANAMERICA);
    const oneFile = await postCsv(env, reservations, "wheelbase");
    assert.equal(oneFile.status, 400);
    assert.match(String((oneFile.data?.fields as { file?: string } | undefined)?.file), /both/i);
    const unknown = await postCsv(env, "Foo,Bar\n1,2\n", "turo");
    assert.equal(unknown.status, 400);
    const imports = await requireDb(env).prepare(`SELECT COUNT(*) AS n FROM trip_imports`).bind().first<{ n: number }>();
    assert.equal(Number(imports?.n), 0);
  });
});

describe("import auth", () => {
  test("requires an admin session, CSRF, and rejects pages.dev", async () => {
    const env = devEnv(PANAMERICA);
    await call(env, "POST", "/api/portal/admin/cars", carBody());
    const csv = turoCsv([turoRow({ "Reservation ID": "AUTH1" })]);
    const signedOut = await uploadImport({ DB: requireDb(env) }, (() => {
      const form = new FormData();
      form.set("file", csvFile("earnings.csv", csv));
      return form;
    })());
    assert.equal(signedOut.status, 401);

    await call(env, "POST", "/api/portal/admin/owners", { name: "Dealer Partner", email: DEALER });
    const dealer = await uploadImport({ ...env, PORTAL_DEV_EMAIL: DEALER }, (() => {
      const form = new FormData();
      form.set("file", csvFile("earnings.csv", csv));
      return form;
    })());
    assert.equal(dealer.status, 403);
    assert.equal(dealer.data?.reason, "not_admin");

    const pages = await handlePortal(
      request("POST", "/api/portal/admin/imports", {
        rawBody: csv,
        headers: { "content-type": "text/csv" },
        host: "https://preview.pages.dev",
        origin: "https://preview.pages.dev",
      }),
      env
    );
    assert.equal(pages.status, 401);

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
    const wrong = await handlePortal(
      request("POST", "/api/portal/admin/imports?platform=turo", {
        rawBody: csv,
        headers: { cookie, "content-type": "text/csv", "x-csrf-token": "wrong" },
      }),
      sessionEnv
    );
    assert.equal(wrong.status, 403);
    assert.equal(((await wrong.json()) as { reason?: string }).reason, "csrf");

    const accepted = await handlePortal(
      request("POST", "/api/portal/admin/imports?platform=turo", {
        rawBody: csv,
        headers: { cookie, "content-type": "text/csv", "x-csrf-token": csrf },
      }),
      sessionEnv
    );
    assert.equal(accepted.status, 201);
  });
});
