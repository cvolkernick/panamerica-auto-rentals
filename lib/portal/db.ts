import type { PortalD1 } from "./d1";
import type { PortalEnv } from "./env";
import type { CarJson, OwnerJson } from "./types";
import type { CarWrite, OwnerWrite } from "./validate";

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

export function uniqueField(error: unknown): "vin" | "email" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE/i.test(message)) return null;
  if (message.includes("vin")) return "vin";
  if (message.includes("email")) return "email";
  return null;
}
