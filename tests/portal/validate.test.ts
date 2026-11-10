import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MIN_CAR_YEAR,
  VIN_ERROR,
  maxCarYear,
  parseCarCreate,
  parseVin,
  parseYear,
} from "../../lib/portal/validate";

const NOW = new Date("2026-11-10T00:00:00Z");

describe("VIN", () => {
  test("accepts 17 characters without I, O, or Q and normalizes case", () => {
    const fields: Record<string, string> = {};
    assert.equal(parseVin("1tstcar0000000001", fields), "1TSTCAR0000000001");
    assert.deepEqual(fields, {});
  });

  test("strips spaces and hyphens before checking length", () => {
    const fields: Record<string, string> = {};
    assert.equal(parseVin("1TSTCAR-0000000001", fields), "1TSTCAR0000000001");
  });

  test("rejects I, O, Q and the wrong length", () => {
    for (const vin of ["1TSTCAR00000000I1", "1TSTCAR00000000O1", "1TSTCAR00000000Q1", "1TSTCAR000000001", "1TSTCAR00000000011"]) {
      const fields: Record<string, string> = {};
      assert.equal(parseVin(vin, fields), undefined);
      assert.equal(fields.vin, VIN_ERROR);
    }
  });
});

describe("year", () => {
  test("accepts the sane range through next calendar year", () => {
    const fields: Record<string, string> = {};
    assert.equal(parseYear(MIN_CAR_YEAR, fields, NOW), MIN_CAR_YEAR);
    assert.equal(parseYear("2024", {}, NOW), 2024);
    assert.equal(parseYear(maxCarYear(NOW), {}, NOW), 2027);
  });

  test("rejects years outside the range and fractional years", () => {
    const tooOld: Record<string, string> = {};
    assert.equal(parseYear(1979, tooOld, NOW), undefined);
    assert.match(tooOld.year, /1980 through 2027/);

    const tooNew: Record<string, string> = {};
    assert.equal(parseYear(maxCarYear(NOW) + 1, tooNew, NOW), undefined);

    const fraction: Record<string, string> = {};
    assert.equal(parseYear(2024.5, fraction, NOW), undefined);
  });
});

describe("car create", () => {
  test("requires every car field", () => {
    const parsed = parseCarCreate({ year: 2024 }, NOW);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.fields.vin);
      assert.ok(parsed.fields.make);
      assert.ok(parsed.fields.ownerId);
    }
  });
});
