import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { parseMoneyToCents } from "../../lib/portal/import/money";
import { parseTuroStamp } from "../../lib/portal/import/dates";
import {
  TURO_HEADERS,
  TURO_REQUIRED_HEADERS,
  plateFromVehicle,
  turoCountsAsIncome,
  turoMapper,
  normalizeVin,
} from "../../lib/portal/import/turo";
import type { MappedTrip } from "../../lib/portal/import/types";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function turoCsv(rows: Record<string, string>[], headers: readonly string[] = TURO_HEADERS): string {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");
}

function turoRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Reservation ID": "T100",
    Guest: "Test Guest",
    Vehicle: "2022 Test Model 3 (TEST-001)",
    "Vehicle name": "2022 Test Model 3",
    "Vehicle id": "10001",
    VIN: "1tst-car 0000000001",
    "Trip start": "2026-11-01 11:00 AM",
    "Trip end": "2026-11-04 3:30 PM",
    "Pickup location": "123 Secret Street",
    "Return location": "500 Hidden Ave",
    "Trip status": "Completed",
    "Trip price": "$400.00",
    "Total earnings": "$380.00",
    ...overrides,
  };
}

function parseRows(csv: string): MappedTrip[] {
  const parsed = turoMapper.parse({
    file: { filename: "earnings.csv", text: csv, bytes: csv.length },
  });
  if (!parsed.ok) assert.fail(parsed.error);
  return parsed.value.trips;
}

describe("turo money and dates", () => {
  test("parses the confirmed money shapes", () => {
    assert.equal(parseMoneyToCents("$12.34"), 1234);
    assert.equal(parseMoneyToCents("- $12.34"), -1234);
    assert.equal(parseMoneyToCents("-$12.34"), -1234);
    assert.equal(parseMoneyToCents("12.34"), 1234);
    assert.equal(parseMoneyToCents("$1,234.56"), 123456);
    assert.equal(parseMoneyToCents("(12.34)"), -1234);
    assert.equal(parseMoneyToCents("$0.00"), 0);
    assert.equal(parseMoneyToCents("10.555"), null);
    assert.equal(parseMoneyToCents(""), null);
  });

  test("keeps AM and PM stamps as naive local text", () => {
    assert.deepEqual(parseTuroStamp("2026-11-01 11:00 AM"), {
      text: "2026-11-01 11:00 AM",
      date: "2026-11-01",
    });
    assert.deepEqual(parseTuroStamp("2026-11-04 3:30 PM"), {
      text: "2026-11-04 3:30 PM",
      date: "2026-11-04",
    });
    assert.equal(parseTuroStamp("2026-11-01 00:00 AM"), null);
    assert.equal(parseTuroStamp("2026-13-01 11:00 AM"), null);
  });
});

describe("turo mapper", () => {
  test("lists the 47 confirmed headers and requires the match columns", () => {
    assert.equal(TURO_HEADERS.length, 47);
    const fixtureHeaders = fixture("turo_earnings_fixture.csv").replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    assert.equal(
      fixtureHeaders,
      TURO_HEADERS.map((header) => `"${header}"`).join(",")
    );
    for (const header of TURO_REQUIRED_HEADERS) assert.equal(TURO_HEADERS.includes(header), true);
  });

  test("normalizes VIN and plate and drops the guest", () => {
    assert.equal(normalizeVin("1tst-car 0000000001"), "1TSTCAR0000000001");
    assert.equal(plateFromVehicle("2022 Test Model 3 (TEST-001)"), "TEST001");
    assert.equal(plateFromVehicle("Name (AB C-12) (xx-1)"), "XX1");
    assert.equal(plateFromVehicle("No plate here"), null);
    const [trip] = parseRows(turoCsv([turoRow()]));
    assert.equal(trip.vin, "1TSTCAR0000000001");
    assert.equal(trip.plate, "TEST001");
    assert.equal(trip.startAt, "2026-11-01 11:00 AM");
    assert.equal(trip.endAt, "2026-11-04 3:30 PM");
    assert.equal(trip.startDate, "2026-11-01");
    assert.equal(trip.grossCents, 40000);
    assert.equal(trip.payoutCents, 38000);
    assert.equal(trip.platformFeesCents, null);
    assert.equal(trip.countsAsIncome, true);
    const encoded = JSON.stringify(trip);
    assert.equal(encoded.includes("Test Guest"), false);
    assert.equal(encoded.includes("Secret Street"), false);
    assert.equal(encoded.includes("Hidden Ave"), false);
    assert.equal("guest" in trip, false);
  });

  test("maps status to income and ignores extra columns", () => {
    const headers = [...TURO_HEADERS, "Bonus Column"];
    const row = turoRow({ "Bonus Column": "ignore me", Guest: "GUEST-DROP-CHECK" });
    const [completed] = parseRows(turoCsv([row], headers));
    assert.equal(completed.countsAsIncome, true);
    assert.equal(JSON.stringify(completed).includes("GUEST-DROP-CHECK"), false);
    assert.equal(JSON.stringify(completed).includes("ignore me"), false);

    const cases: [Record<string, string>, boolean][] = [
      [{ "Trip status": "Booked", "Total earnings": "$10.00" }, false],
      [{ "Trip status": "In-progress", "Total earnings": "$10.00" }, false],
      [{ "Trip status": "Guest cancellation", "Total earnings": "$15.00" }, true],
      [{ "Trip status": "Guest cancellation", "Total earnings": "$0.00" }, false],
      [{ "Trip status": "Host cancellation", "Total earnings": "- $6.06" }, true],
      [{ "Trip status": "Host cancellation", "Total earnings": "$0.00" }, false],
    ];
    for (const [overrides, counts] of cases) {
      assert.equal(turoCountsAsIncome(overrides["Trip status"], parseMoneyToCents(overrides["Total earnings"]) ?? 0), counts);
      const [trip] = parseRows(turoCsv([turoRow(overrides)]));
      assert.equal(trip.countsAsIncome, counts, overrides["Trip status"]);
    }
  });

  test("rejects a file that is missing a required header", () => {
    const headers = TURO_HEADERS.filter((header) => header !== "Total earnings");
    const parsed = turoMapper.parse({
      file: { filename: "bad.csv", text: turoCsv([turoRow()], headers), bytes: 10 },
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /Total earnings/);
  });

  test("parses the anonymized earnings fixture", () => {
    const parsed = turoMapper.parse({
      file: {
        filename: "turo_earnings_fixture.csv",
        text: fixture("turo_earnings_fixture.csv"),
        bytes: 1,
      },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.trips.length, 3);
    const booked = parsed.value.trips.find((trip) => trip.externalTripId === "T90000003");
    assert.equal(booked?.countsAsIncome, false);
    assert.equal(JSON.stringify(parsed.value).includes("Test Guest"), false);
  });
});
