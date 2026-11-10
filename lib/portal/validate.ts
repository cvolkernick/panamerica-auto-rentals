export const MIN_CAR_YEAR = 1980;

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
