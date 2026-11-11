import { isLedgerType, LEDGER_NOTE_MAX, type LedgerType } from "./ledger";

export const MIN_CAR_YEAR = 1980;
export const MIN_LEDGER_YEAR = 1980;
export const MAX_LEDGER_YEAR = 2100;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const PLATE_PATTERN = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;

export const VIN_ERROR =
  "VIN must be 17 characters and cannot contain I, O, or Q.";

export type FieldErrors = Record<string, string>;

export type OwnerWrite = {
  name: string;
  email: string;
  storedAdmin: boolean;
};

export type CarWrite = {
  ownerId: number;
  year: number;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
};

export type OwnerPatch = Partial<OwnerWrite>;
export type CarPatch = Partial<CarWrite>;

export type LedgerWrite = {
  entryDate: string;
  type: LedgerType;
  amountCents: number;
  note: string | null;
};

export type LedgerPatch = Partial<LedgerWrite>;

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; fields: FieldErrors };
export type ParseResult<T> = ParseOk<T> | ParseFail;

export function maxCarYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(fields: FieldErrors): ParseFail {
  return { ok: false, fields };
}

function cleanText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fields: FieldErrors
): string | undefined {
  if (typeof value !== "string") {
    fields[field] = "Enter text.";
    return;
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (/[\u0000-\u001F]/.test(text) || text.length < min || text.length > max) {
    fields[field] = `Use ${min} to ${max} characters.`;
    return;
  }
  return text;
}

function parseEmail(value: unknown, fields: FieldErrors): string | undefined {
  if (typeof value !== "string") {
    fields.email = "Enter an email.";
    return;
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.email = "Enter a valid email.";
    return;
  }
  return email;
}

function parseStoredAdmin(
  value: unknown,
  fields: FieldErrors
): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0") return false;
  if (value === 1 || value === "1") return true;
  fields.storedAdmin = "Choose yes or no.";
  return;
}

export function parseVin(value: unknown, fields: FieldErrors): string | undefined {
  if (typeof value !== "string") {
    fields.vin = VIN_ERROR;
    return;
  }
  const vin = value.replace(/[\s-]/g, "").toUpperCase();
  if (!VIN_PATTERN.test(vin)) {
    fields.vin = VIN_ERROR;
    return;
  }
  return vin;
}

export function parseYear(
  value: unknown,
  fields: FieldErrors,
  now: Date
): number | undefined {
  let year: number;
  if (typeof value === "number") {
    year = value;
  } else if (typeof value === "string" && /^\d{4}$/.test(value.trim())) {
    year = Number(value.trim());
  } else {
    year = Number.NaN;
  }
  const max = maxCarYear(now);
  if (!Number.isInteger(year) || year < MIN_CAR_YEAR || year > max) {
    fields.year = `Year must be a whole number from ${MIN_CAR_YEAR} through ${max}.`;
    return;
  }
  return year;
}

function parsePlate(value: unknown, fields: FieldErrors): string | undefined {
  if (typeof value !== "string") {
    fields.licensePlate = "Enter a license plate.";
    return;
  }
  const plate = value.trim().toUpperCase().replace(/\s+/g, " ");
  if (plate.length < 1 || plate.length > 12 || !PLATE_PATTERN.test(plate)) {
    fields.licensePlate =
      "Enter a plate using letters, numbers, spaces, or hyphens (12 characters max).";
    return;
  }
  return plate;
}

function parseOwnerId(value: unknown, fields: FieldErrors): number | undefined {
  let id: number;
  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    id = Number(value.trim());
  } else {
    id = Number.NaN;
  }
  if (!Number.isSafeInteger(id) || id <= 0) {
    fields.ownerId = "Choose an owner.";
    return;
  }
  return id;
}

function readStoredAdmin(body: Record<string, unknown>, fields: FieldErrors) {
  if ("storedAdmin" in body) return parseStoredAdmin(body.storedAdmin, fields);
  if ("isAdmin" in body) return parseStoredAdmin(body.isAdmin, fields);
  fields.storedAdmin = "Choose yes or no.";
  return;
}

export function parseOwnerCreate(body: unknown): ParseResult<OwnerWrite> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const name = cleanText(body.name, "name", 1, 120, fields);
  const email = parseEmail(body.email, fields);
  const storedAdmin =
    body.storedAdmin === undefined && body.isAdmin === undefined
      ? false
      : readStoredAdmin(body, fields);
  if (Object.keys(fields).length > 0 || name === undefined || email === undefined) {
    return fail(fields);
  }
  return { ok: true, value: { name, email, storedAdmin: storedAdmin ?? false } };
}

export function parseOwnerPatch(body: unknown): ParseResult<OwnerPatch> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const value: OwnerPatch = {};
  if ("name" in body) value.name = cleanText(body.name, "name", 1, 120, fields);
  if ("email" in body) value.email = parseEmail(body.email, fields);
  if ("storedAdmin" in body || "isAdmin" in body) {
    value.storedAdmin = readStoredAdmin(body, fields);
  }
  if (Object.keys(value).length === 0 && Object.keys(fields).length === 0) {
    fields.body = "Nothing to update.";
  }
  if (Object.keys(fields).length > 0) return fail(fields);
  return { ok: true, value };
}

export function parseCarCreate(
  body: unknown,
  now: Date = new Date()
): ParseResult<CarWrite> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const ownerId = parseOwnerId(body.ownerId, fields);
  const year = parseYear(body.year, fields, now);
  const make = cleanText(body.make, "make", 1, 40, fields);
  const model = cleanText(body.model, "model", 1, 40, fields);
  const color = cleanText(body.color, "color", 1, 40, fields);
  const licensePlate = parsePlate(body.licensePlate, fields);
  const vin = parseVin(body.vin, fields);
  if (
    Object.keys(fields).length > 0 ||
    ownerId === undefined ||
    year === undefined ||
    make === undefined ||
    model === undefined ||
    color === undefined ||
    licensePlate === undefined ||
    vin === undefined
  ) {
    return fail(fields);
  }
  return {
    ok: true,
    value: { ownerId, year, make, model, color, licensePlate, vin },
  };
}

export function parseCarPatch(
  body: unknown,
  now: Date = new Date()
): ParseResult<CarPatch> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const value: CarPatch = {};
  if ("ownerId" in body) value.ownerId = parseOwnerId(body.ownerId, fields);
  if ("year" in body) value.year = parseYear(body.year, fields, now);
  if ("make" in body) value.make = cleanText(body.make, "make", 1, 40, fields);
  if ("model" in body) value.model = cleanText(body.model, "model", 1, 40, fields);
  if ("color" in body) value.color = cleanText(body.color, "color", 1, 40, fields);
  if ("licensePlate" in body) {
    value.licensePlate = parsePlate(body.licensePlate, fields);
  }
  if ("vin" in body) value.vin = parseVin(body.vin, fields);
  if (Object.keys(value).length === 0 && Object.keys(fields).length === 0) {
    fields.body = "Nothing to update.";
  }
  if (Object.keys(fields).length > 0) return fail(fields);
  return { ok: true, value };
}

const LEDGER_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEDGER_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseLedgerDate(value: unknown, fields: FieldErrors): string | undefined {
  if (typeof value !== "string" || !LEDGER_DATE.test(value)) {
    fields.entryDate = "Use a real date as YYYY-MM-DD.";
    return;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < MIN_LEDGER_YEAR ||
    year > MAX_LEDGER_YEAR ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fields.entryDate = "Use a real date as YYYY-MM-DD.";
    return;
  }
  return value;
}

function parseLedgerType(value: unknown, fields: FieldErrors): LedgerType | undefined {
  if (typeof value !== "string" || !isLedgerType(value)) {
    fields.type = "Choose a ledger type.";
    return;
  }
  return value;
}

function parseAmountCents(value: unknown, fields: FieldErrors): number | undefined {
  let amount: number;
  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    amount = Number(value.trim());
  } else {
    fields.amountCents = "Enter a positive whole number of cents.";
    return;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fields.amountCents = "Enter a positive whole number of cents.";
    return;
  }
  return amount;
}

function parseLedgerNote(value: unknown, fields: FieldErrors): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") {
    fields.note = "Enter text.";
    return;
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (/[\u0000-\u001F]/.test(text) || text.length > LEDGER_NOTE_MAX) {
    fields.note = `Use ${LEDGER_NOTE_MAX} characters or fewer.`;
    return;
  }
  return text;
}

export function parseLedgerMonth(value: string | null): ParseResult<string | null> {
  if (value === null) return { ok: true, value: null };
  const month = value.trim();
  if (!LEDGER_MONTH.test(month)) return fail({ month: "Use a month as YYYY-MM." });
  return { ok: true, value: month };
}

export function parseLedgerCreate(body: unknown): ParseResult<LedgerWrite> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const entryDate = parseLedgerDate(body.entryDate, fields);
  const type = parseLedgerType(body.type, fields);
  const amountCents = parseAmountCents(body.amountCents, fields);
  const note = "note" in body ? parseLedgerNote(body.note, fields) : null;
  if (
    Object.keys(fields).length > 0 ||
    entryDate === undefined ||
    type === undefined ||
    amountCents === undefined ||
    note === undefined
  ) {
    return fail(fields);
  }
  return { ok: true, value: { entryDate, type, amountCents, note } };
}

export function parseLedgerPatch(body: unknown): ParseResult<LedgerPatch> {
  if (!isRecord(body)) return fail({ body: "Expected an object." });
  const fields: FieldErrors = {};
  const value: LedgerPatch = {};
  if ("entryDate" in body) value.entryDate = parseLedgerDate(body.entryDate, fields);
  if ("type" in body) value.type = parseLedgerType(body.type, fields);
  if ("amountCents" in body) value.amountCents = parseAmountCents(body.amountCents, fields);
  if ("note" in body) value.note = parseLedgerNote(body.note, fields);
  if (Object.keys(value).length === 0 && Object.keys(fields).length === 0) {
    fields.body = "Nothing to update.";
  }
  if (Object.keys(fields).length > 0) return fail(fields);
  return { ok: true, value };
}
