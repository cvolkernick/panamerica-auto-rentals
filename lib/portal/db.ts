import type { PortalD1 } from "./d1";
import type { PortalEnv } from "./env";
import type { LedgerType } from "./ledger";
import type { CarJson, LedgerEntryJson, OwnerJson } from "./types";
import type { CarWrite, LedgerWrite, OwnerWrite } from "./validate";

export type OwnerRow = {
  id: number;
  name: string;
  email: string;
  is_admin: number;
  created_at: string;
};

export type CarRow = {
  id: number;
  owner_id: number;
  year: number;
  make: string;
  model: string;
  color: string;
  license_plate: string;
  vin: string;
  created_at: string;
  updated_at: string;
  owner_name?: string;
  owner_email?: string;
};

const CAR_COLUMNS =
  "id, owner_id, year, make, model, color, license_plate, vin, created_at, updated_at";

/**
 * Owner-scoped reads. The second bound value is always the session owner id.
 * Owner routes must use these statements and must not read cars by id alone.
 */
export const OWNER_CARS_SQL = `SELECT ${CAR_COLUMNS} FROM cars WHERE owner_id = ? ORDER BY year DESC, make, model, id`;

export const OWNER_CAR_BY_ID_SQL = `SELECT ${CAR_COLUMNS} FROM cars WHERE id = ? AND owner_id = ?`;

const ADMIN_CARS_SQL = `SELECT c.id, c.owner_id, c.year, c.make, c.model, c.color, c.license_plate, c.vin, c.created_at, c.updated_at, o.name AS owner_name, o.email AS owner_email FROM cars c JOIN owners o ON o.id = c.owner_id ORDER BY o.name, c.year DESC, c.id`;

const ADMIN_CAR_BY_ID_SQL = `SELECT c.id, c.owner_id, c.year, c.make, c.model, c.color, c.license_plate, c.vin, c.created_at, c.updated_at, o.name AS owner_name, o.email AS owner_email FROM cars c JOIN owners o ON o.id = c.owner_id WHERE c.id = ?`;

const INSERT_CAR_SQL = `INSERT INTO cars (owner_id, year, make, model, color, license_plate, vin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const UPDATE_CAR_SQL = `UPDATE cars SET owner_id = ?, year = ?, make = ?, model = ?, color = ?, license_plate = ?, vin = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`;

const OWNER_COLUMNS = "id, name, email, is_admin, created_at";

export function adminEmailSet(env: PortalEnv): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.includes("@"))
  );
}

export function effectiveAdmin(row: OwnerRow, env: PortalEnv): boolean {
  if (Number(row.is_admin) === 1) return true;
  return adminEmailSet(env).has(row.email.trim().toLowerCase());
}

export function ownerJson(row: OwnerRow, env: PortalEnv): OwnerJson {
  const email = row.email.trim().toLowerCase();
  const storedAdmin = Number(row.is_admin) === 1;
  return {
    id: Number(row.id),
    name: row.name,
    email,
    storedAdmin,
    isAdmin: storedAdmin || adminEmailSet(env).has(email),
    createdAt: row.created_at,
  };
}

export function carJson(row: CarRow): CarJson {
  const car: CarJson = {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    year: Number(row.year),
    make: row.make,
    model: row.model,
    color: row.color,
    licensePlate: row.license_plate,
    vin: row.vin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.owner_name) car.ownerName = row.owner_name;
  if (row.owner_email) car.ownerEmail = row.owner_email.trim().toLowerCase();
  return car;
}

export async function getOwnerByEmail(
  db: PortalD1,
  email: string
): Promise<OwnerRow | null> {
  return db
    .prepare(`SELECT ${OWNER_COLUMNS} FROM owners WHERE email = ?`)
    .bind(email.trim().toLowerCase())
    .first<OwnerRow>();
}

export async function getOwnerById(db: PortalD1, id: number): Promise<OwnerRow | null> {
  return db
    .prepare(`SELECT ${OWNER_COLUMNS} FROM owners WHERE id = ?`)
    .bind(id)
    .first<OwnerRow>();
}

export async function listOwners(db: PortalD1): Promise<OwnerRow[]> {
  const result = await db
    .prepare(`SELECT ${OWNER_COLUMNS} FROM owners ORDER BY name, id`)
    .bind()
    .all<OwnerRow>();
  return result.results;
}

export async function countStoredAdmins(db: PortalD1): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM owners WHERE is_admin = 1`)
    .bind()
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function insertOwner(db: PortalD1, owner: OwnerWrite): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO owners (name, email, is_admin) VALUES (?, ?, ?)`
    )
    .bind(owner.name, owner.email, owner.storedAdmin ? 1 : 0)
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateOwner(
  db: PortalD1,
  id: number,
  owner: OwnerWrite
): Promise<void> {
  await db
    .prepare(`UPDATE owners SET name = ?, email = ?, is_admin = ? WHERE id = ?`)
    .bind(owner.name, owner.email, owner.storedAdmin ? 1 : 0, id)
    .run();
}

export async function listOwnedCars(db: PortalD1, ownerId: number): Promise<CarRow[]> {
  const result = await db.prepare(OWNER_CARS_SQL).bind(ownerId).all<CarRow>();
  return result.results;
}

export async function getOwnedCar(
  db: PortalD1,
  carId: number,
  ownerId: number
): Promise<CarRow | null> {
  return db.prepare(OWNER_CAR_BY_ID_SQL).bind(carId, ownerId).first<CarRow>();
}

export async function listAllCars(db: PortalD1): Promise<CarRow[]> {
  const result = await db.prepare(ADMIN_CARS_SQL).bind().all<CarRow>();
  return result.results;
}

export async function getCarById(db: PortalD1, carId: number): Promise<CarRow | null> {
  return db.prepare(ADMIN_CAR_BY_ID_SQL).bind(carId).first<CarRow>();
}

export async function insertCar(db: PortalD1, car: CarWrite): Promise<number> {
  const result = await db
    .prepare(INSERT_CAR_SQL)
    .bind(
      car.ownerId,
      car.year,
      car.make,
      car.model,
      car.color,
      car.licensePlate,
      car.vin
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateCar(db: PortalD1, id: number, car: CarWrite): Promise<void> {
  await db
    .prepare(UPDATE_CAR_SQL)
    .bind(
      car.ownerId,
      car.year,
      car.make,
      car.model,
      car.color,
      car.licensePlate,
      car.vin,
      id
    )
    .run();
}

export async function deleteCar(db: PortalD1, id: number): Promise<void> {
  await db.prepare(`DELETE FROM cars WHERE id = ?`).bind(id).run();
}

export async function getPasswordHash(db: PortalD1, ownerId: number): Promise<string | null> {
  const row = await db
    .prepare(`SELECT password_hash FROM owners WHERE id = ?`)
    .bind(ownerId)
    .first<{ password_hash: string | null }>();
  const hash = row?.password_hash;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

export async function updatePasswordHash(
  db: PortalD1,
  ownerId: number,
  passwordHash: string
): Promise<void> {
  await db
    .prepare(`UPDATE owners SET password_hash = ? WHERE id = ?`)
    .bind(passwordHash, ownerId)
    .run();
}

export type SessionRow = {
  owner_id: number;
  csrf_secret: string;
  expires_at: string;
};

export async function insertSession(
  db: PortalD1,
  idHash: string,
  ownerId: number,
  csrfSecret: string,
  expiresAt: string,
  createdAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, owner_id, csrf_secret, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(idHash, ownerId, csrfSecret, expiresAt, createdAt)
    .run();
}

export async function getSessionByHash(db: PortalD1, idHash: string): Promise<SessionRow | null> {
  return db
    .prepare(`SELECT owner_id, csrf_secret, expires_at FROM sessions WHERE id_hash = ?`)
    .bind(idHash)
    .first<SessionRow>();
}

export async function deleteSessionByHash(db: PortalD1, idHash: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(idHash).run();
}

export async function deleteSessionsForOwner(db: PortalD1, ownerId: number): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE owner_id = ?`).bind(ownerId).run();
}

export async function deleteExpiredSessions(db: PortalD1, nowIso: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(nowIso).run();
}

export async function insertLoginAttempt(
  db: PortalD1,
  email: string,
  ip: string,
  createdAt: string
): Promise<void> {
  await db
    .prepare(`INSERT INTO login_attempts (email, ip, created_at) VALUES (?, ?, ?)`)
    .bind(email, ip, createdAt)
    .run();
}

export async function deleteOldLoginAttempts(db: PortalD1, cutoffIso: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE created_at <= ?`).bind(cutoffIso).run();
}

export async function countLoginFailuresForEmail(
  db: PortalD1,
  email: string,
  cutoffIso: string
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND created_at > ?`)
    .bind(email, cutoffIso)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function countLoginFailuresForIpv6Prefix(
  db: PortalD1,
  email: string,
  prefix48: string,
  cutoffIso: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ip LIKE ? ESCAPE '\\' AND created_at > ?`
    )
    .bind(email, `${prefix48.replace(/[\\%_]/g, "\\$&")}:%`, cutoffIso)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function countLoginFailuresForPair(
  db: PortalD1,
  email: string,
  ip: string,
  cutoffIso: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ip = ? AND created_at > ?`
    )
    .bind(email, ip, cutoffIso)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export type OwnerInviteRow = {
  token_hash: string;
  owner_id: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export async function invalidateUnusedInvites(
  db: PortalD1,
  ownerId: number,
  usedAt: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE owner_invites SET used_at = ? WHERE owner_id = ? AND used_at IS NULL`
    )
    .bind(usedAt, ownerId)
    .run();
}

export async function insertOwnerInvite(
  db: PortalD1,
  tokenHash: string,
  ownerId: number,
  createdAt: string,
  expiresAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO owner_invites (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
    )
    .bind(tokenHash, ownerId, createdAt, expiresAt)
    .run();
}

export async function getOwnerInviteByHash(
  db: PortalD1,
  tokenHash: string
): Promise<OwnerInviteRow | null> {
  return db
    .prepare(
      `SELECT token_hash, owner_id, created_at, expires_at, used_at FROM owner_invites WHERE token_hash = ?`
    )
    .bind(tokenHash)
    .first<OwnerInviteRow>();
}

/** Claims one unused, unexpired invite. Returns false when another request already claimed it. */
export async function claimOwnerInvite(
  db: PortalD1,
  tokenHash: string,
  usedAt: string,
  nowIso: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE owner_invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
    )
    .bind(usedAt, tokenHash, nowIso)
    .run();
  return result.meta.changes === 1;
}

export type LedgerRow = {
  id: number;
  car_id: number;
  entry_date: string;
  type: LedgerType;
  amount_cents: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: number;
};

const LEDGER_COLUMNS =
  "id, car_id, entry_date, type, amount_cents, note, created_at, updated_at, created_by";

const LIST_LEDGER_SQL = `SELECT ${LEDGER_COLUMNS} FROM car_ledger WHERE car_id = ? ORDER BY entry_date DESC, id DESC`;

const LIST_LEDGER_MONTH_SQL = `SELECT ${LEDGER_COLUMNS} FROM car_ledger WHERE car_id = ? AND entry_date >= ? AND entry_date < ? ORDER BY entry_date DESC, id DESC`;

const LEDGER_BY_ID_SQL = `SELECT ${LEDGER_COLUMNS} FROM car_ledger WHERE id = ? AND car_id = ?`;

const INSERT_LEDGER_SQL = `INSERT INTO car_ledger (car_id, entry_date, type, amount_cents, note, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`;

const UPDATE_LEDGER_SQL = `UPDATE car_ledger SET entry_date = ?, type = ?, amount_cents = ?, note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND car_id = ?`;

export function ledgerJson(row: LedgerRow): LedgerEntryJson {
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    entryDate: row.entry_date,
    type: row.type,
    amountCents: Number(row.amount_cents),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: Number(row.created_by),
  };
}

export async function listLedgerEntries(
  db: PortalD1,
  carId: number,
  range?: { start: string; end: string }
): Promise<LedgerRow[]> {
  if (range) {
    const result = await db
      .prepare(LIST_LEDGER_MONTH_SQL)
      .bind(carId, range.start, range.end)
      .all<LedgerRow>();
    return result.results;
  }
  const result = await db.prepare(LIST_LEDGER_SQL).bind(carId).all<LedgerRow>();
  return result.results;
}

export async function getLedgerEntry(
  db: PortalD1,
  carId: number,
  entryId: number
): Promise<LedgerRow | null> {
  return db.prepare(LEDGER_BY_ID_SQL).bind(entryId, carId).first<LedgerRow>();
}

export async function insertLedgerEntry(
  db: PortalD1,
  carId: number,
  entry: LedgerWrite,
  createdBy: number
): Promise<number> {
  const result = await db
    .prepare(INSERT_LEDGER_SQL)
    .bind(carId, entry.entryDate, entry.type, entry.amountCents, entry.note, createdBy)
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateLedgerEntry(
  db: PortalD1,
  carId: number,
  entryId: number,
  entry: LedgerWrite
): Promise<void> {
  await db
    .prepare(UPDATE_LEDGER_SQL)
    .bind(entry.entryDate, entry.type, entry.amountCents, entry.note, entryId, carId)
    .run();
}

export async function deleteLedgerEntry(
  db: PortalD1,
  carId: number,
  entryId: number
): Promise<void> {
  await db.prepare(`DELETE FROM car_ledger WHERE id = ? AND car_id = ?`).bind(entryId, carId).run();
}

export function isForeignKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /FOREIGN KEY constraint failed/i.test(message);
}

export function uniqueField(error: unknown): "vin" | "email" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE/i.test(message)) return null;
  if (message.includes("vin")) return "vin";
  if (message.includes("email")) return "email";
  return null;
}
