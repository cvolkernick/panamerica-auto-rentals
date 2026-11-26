import { randomToken } from "./codec";
import type { D1Prepared, PortalD1 } from "./d1";
import { carLedgerStart, clampToLedgerStart } from "./ledger-start";
import { adminEmailSet } from "./db";
import type { PortalEnv } from "./env";
import { isMissingAccountColumn } from "./managers";

/** Platform label for income entered through the team connector. Imports never use it. */
export const MANUAL_PLATFORM = "manual";

export type TeamAction =
  | "car.update"
  | "expense.create"
  | "expense.update"
  | "expense.delete"
  | "income.create"
  | "income.update"
  | "income.delete";

export type WriteLogRow = {
  id: number;
  created_at: string;
  agent_name: string;
  action: TeamAction;
  car_id: number;
  entity_id: number;
  before_json: string | null;
  after_json: string | null;
};

export type IncomeRow = {
  id: number;
  car_id: number;
  platform: string;
  external_trip_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  counts_as_income: number;
  gross_cents: number | null;
  platform_fees_cents: number | null;
  payout_cents: number;
  tax_cents: number | null;
  import_id: number | null;
  imported_at: string;
  updated_at: string;
};

export type IncomeWrite = {
  startDate: string;
  endDate: string;
  payoutCents: number;
  grossCents: number | null;
  platformFeesCents: number | null;
  taxCents: number | null;
};

const INCOME_COLUMNS = `id, car_id, platform, external_trip_id, start_date, end_date, status,
  counts_as_income, gross_cents, platform_fees_cents, payout_cents, tax_cents, import_id,
  imported_at, updated_at`;

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function teamActorId(db: PortalD1): Promise<number | null> {
  const row = await db
    .prepare(`SELECT id FROM owners WHERE is_admin = 1 ORDER BY id LIMIT 1`)
    .bind()
    .first<{ id: number }>();
  return row ? Number(row.id) : null;
}

/** Largest single expense or income entry the connector accepts: $50,000. */
export const MAX_ENTRY_CENTS = 5_000_000;

type LogEntry = {
  agentName: string;
  action: TeamAction;
  carId: number;
  /** "last_insert" binds to the row the previous statement in the same batch inserted. */
  entityId: number | "last_insert";
  before: unknown;
  after: unknown;
};

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function writeLogStatement(db: PortalD1, entry: LogEntry): D1Prepared {
  const entitySql = entry.entityId === "last_insert" ? "last_insert_rowid()" : "?";
  const values: unknown[] = [entry.agentName, entry.action, entry.carId];
  if (entry.entityId !== "last_insert") values.push(entry.entityId);
  values.push(jsonOrNull(entry.before), jsonOrNull(entry.after));
  return db
    .prepare(
      `INSERT INTO team_write_log (agent_name, action, car_id, entity_id, before_json, after_json)
       VALUES (?, ?, ?, ${entitySql}, ?, ?)`
    )
    .bind(...values);
}

/**
 * Runs a write and its log row as one D1 batch (one transaction). If the log row fails,
 * the write rolls back too. Returns the last_row_id of each statement.
 */
export async function runLogged(db: PortalD1, write: D1Prepared, log: D1Prepared): Promise<number[]> {
  if (typeof db.batch !== "function") throw new Error("d1_batch_unavailable");
  const results = (await db.batch([write, log])) as { meta?: { last_row_id?: number } }[];
  return results.map((result) => Number(result?.meta?.last_row_id ?? 0));
}

export function insertExpenseStatement(
  db: PortalD1,
  carId: number,
  expense: { entryDate: string; category: string; amountCents: number; note: string | null },
  actorId: number
): D1Prepared {
  return db
    .prepare(
      `INSERT INTO expenses (car_id, entry_date, category, amount_cents, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(carId, expense.entryDate, expense.category, expense.amountCents, expense.note, actorId);
}

export function updateExpenseStatement(
  db: PortalD1,
  carId: number,
  expenseId: number,
  expense: { entryDate: string; category: string; amountCents: number; note: string | null }
): D1Prepared {
  return db
    .prepare(
      `UPDATE expenses
       SET entry_date = ?, category = ?, amount_cents = ?, note = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND car_id = ?`
    )
    .bind(expense.entryDate, expense.category, expense.amountCents, expense.note, expenseId, carId);
}

export function deleteExpenseStatement(db: PortalD1, carId: number, expenseId: number): D1Prepared {
  return db.prepare(`DELETE FROM expenses WHERE id = ? AND car_id = ?`).bind(expenseId, carId);
}

export function updateCarStatement(
  db: PortalD1,
  carId: number,
  car: { year: number; make: string; model: string; color: string; licensePlate: string; vin: string }
): D1Prepared {
  return db
    .prepare(
      `UPDATE cars SET year = ?, make = ?, model = ?, color = ?, license_plate = ?, vin = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    )
    .bind(car.year, car.make, car.model, car.color, car.licensePlate, car.vin, carId);
}

export async function listWriteLog(
  db: PortalD1,
  options: { carId?: number; limit: number }
): Promise<WriteLogRow[]> {
  const columns = "id, created_at, agent_name, action, car_id, entity_id, before_json, after_json";
  const result = options.carId
    ? await db
        .prepare(`SELECT ${columns} FROM team_write_log WHERE car_id = ? ORDER BY id DESC LIMIT ?`)
        .bind(options.carId, options.limit)
        .all<WriteLogRow>()
    : await db
        .prepare(`SELECT ${columns} FROM team_write_log ORDER BY id DESC LIMIT ?`)
        .bind(options.limit)
        .all<WriteLogRow>();
  return result.results;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function writeLogJson(row: WriteLogRow) {
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    agentName: row.agent_name,
    action: row.action,
    carId: Number(row.car_id),
    entityId: Number(row.entity_id),
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
  };
}

/** True when the connector itself created this row (its create is in the write log). */
export async function connectorCreated(
  db: PortalD1,
  action: "expense.create" | "income.create",
  carId: number,
  entityId: number
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM team_write_log WHERE action = ? AND car_id = ? AND entity_id = ? LIMIT 1`
    )
    .bind(action, carId, entityId)
    .first<{ ok: number }>();
  return Boolean(row);
}

export function incomeJson(row: IncomeRow) {
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    platform: row.platform,
    externalTripId: row.external_trip_id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    countsAsIncome: Number(row.counts_as_income) === 1,
    payoutCents: Number(row.payout_cents),
    grossCents: num(row.gross_cents),
    platformFeesCents: num(row.platform_fees_cents),
    taxCents: num(row.tax_cents),
    /** Only manual (connector) income can be edited here. Imported trips change by re-import. */
    editable: row.platform.toLowerCase() === MANUAL_PLATFORM,
    createdAt: row.imported_at,
    updatedAt: row.updated_at,
  };
}

export async function listIncome(
  db: PortalD1,
  carId: number,
  bounds?: { start: string; end: string }
): Promise<IncomeRow[]> {
  // Income lists only trips that count: on or after the car's ledger start.
  const ledgerStart = await carLedgerStart(db, carId);
  const counted = bounds ? clampToLedgerStart(bounds, ledgerStart) : null;
  const result = counted
    ? await db
        .prepare(
          `SELECT ${INCOME_COLUMNS} FROM trips
           WHERE car_id = ? AND start_date >= ? AND start_date < ? ORDER BY start_date, id`
        )
        .bind(carId, counted.start, counted.end)
        .all<IncomeRow>()
    : await db
        .prepare(`SELECT ${INCOME_COLUMNS} FROM trips WHERE car_id = ? AND start_date >= ? ORDER BY start_date, id`)
        .bind(carId, ledgerStart)
        .all<IncomeRow>();
  return result.results;
}

export async function getIncome(db: PortalD1, carId: number, id: number): Promise<IncomeRow | null> {
  return db
    .prepare(`SELECT ${INCOME_COLUMNS} FROM trips WHERE id = ? AND car_id = ?`)
    .bind(id, carId)
    .first<IncomeRow>();
}

export function newManualTripId(): string {
  return `manual-${randomToken(9)}`;
}

export function insertManualIncomeStatement(
  db: PortalD1,
  carId: number,
  externalId: string,
  income: IncomeWrite
): D1Prepared {
  return db
    .prepare(
      `INSERT INTO trips (
         car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income,
         gross_cents, platform_fees_cents, payout_cents, tax_cents, has_pending, import_id
       ) VALUES (?, ?, ?, ?, ?, 'completed', 1, ?, ?, ?, ?, 0, NULL)`
    )
    .bind(
      carId,
      MANUAL_PLATFORM,
      externalId,
      income.startDate,
      income.endDate,
      income.grossCents,
      income.platformFeesCents,
      income.payoutCents,
      income.taxCents
    );
}

export function updateManualIncomeStatement(
  db: PortalD1,
  carId: number,
  id: number,
  income: IncomeWrite
): D1Prepared {
  return db
    .prepare(
      `UPDATE trips
       SET start_date = ?, end_date = ?, gross_cents = ?, platform_fees_cents = ?,
           payout_cents = ?, tax_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND car_id = ? AND platform = ?`
    )
    .bind(
      income.startDate,
      income.endDate,
      income.grossCents,
      income.platformFeesCents,
      income.payoutCents,
      income.taxCents,
      id,
      carId,
      MANUAL_PLATFORM
    );
}

export function deleteManualIncomeStatement(db: PortalD1, carId: number, id: number): D1Prepared {
  return db
    .prepare(`DELETE FROM trips WHERE id = ? AND car_id = ? AND platform = ?`)
    .bind(id, carId, MANUAL_PLATFORM);
}

/**
 * Car-to-manager lookup for the team connector (read-only).
 *
 * The current manager is the car_manager_assignments row that covers `today`
 * (America/New_York): start_date <= today AND (end_date IS NULL OR end_date > today).
 * start_date is inclusive and end_date exclusive, the same rule as assignmentCovers()
 * in managers.ts. owner_type is "company" when the car's owner is an admin account
 * (stored is_admin or ADMIN_EMAILS, as effectiveAdmin() in db.ts), otherwise "client".
 *
 * Never returns owner names, owner emails, manager emails, or phone numbers. The owner
 * email is read only to evaluate ADMIN_EMAILS and is dropped before the JSON is built.
 * contact_ref is an opaque "manager:<id>" key that callers map to a contact themselves.
 */
type CarManagerRow = {
  car_id: number;
  owner_is_admin: number | null;
  owner_email: string | null;
  manager_id: number | null;
  manager_name: string | null;
  start_date: string | null;
  account_id: number | null;
};

export type TeamManagerJson = {
  id: number;
  name: string;
  since: string;
  contact_ref: string;
  has_portal_account: boolean;
};

export type TeamCarManagerJson = {
  car_id: number;
  manager: TeamManagerJson | null;
  owner_type: "company" | "client";
};

function carManagerSql(withAccount: boolean, oneCar: boolean): string {
  return `SELECT c.id AS car_id, o.is_admin AS owner_is_admin, o.email AS owner_email,
       a.manager_id AS manager_id, m.name AS manager_name, a.start_date AS start_date,
       ${withAccount ? "m.account_id" : "NULL"} AS account_id
  FROM cars c
  LEFT JOIN owners o ON o.id = c.owner_id
  LEFT JOIN car_manager_assignments a
    ON a.car_id = c.id AND a.start_date <= ? AND (a.end_date IS NULL OR a.end_date > ?)
  LEFT JOIN managers m ON m.id = a.manager_id
  ${oneCar ? "WHERE c.id = ?" : ""}
  ORDER BY c.id, a.start_date DESC, a.id DESC`;
}

async function carManagerRows(db: PortalD1, today: string, carId?: number): Promise<CarManagerRow[]> {
  const binds: unknown[] = carId === undefined ? [today, today] : [today, today, carId];
  const run = (withAccount: boolean) =>
    db
      .prepare(carManagerSql(withAccount, carId !== undefined))
      .bind(...binds)
      .all<CarManagerRow>();
  try {
    return (await run(true)).results;
  } catch (error) {
    // Before migration 0009 there is no managers.account_id: report no portal accounts.
    if (isMissingAccountColumn(error)) return (await run(false)).results;
    throw error;
  }
}

function carManagerJson(row: CarManagerRow, admins: Set<string>): TeamCarManagerJson {
  const company =
    Number(row.owner_is_admin) === 1 || admins.has((row.owner_email ?? "").trim().toLowerCase());
  const manager =
    row.manager_id === null || row.manager_id === undefined || !row.manager_name || !row.start_date
      ? null
      : {
          id: Number(row.manager_id),
          name: row.manager_name,
          since: row.start_date,
          contact_ref: `manager:${Number(row.manager_id)}`,
          has_portal_account: row.account_id !== null && row.account_id !== undefined,
        };
  return { car_id: Number(row.car_id), manager, owner_type: company ? "company" : "client" };
}

/** One row per car: the first (latest-starting) covering assignment wins. */
export async function listCarManagers(db: PortalD1, env: PortalEnv, today: string): Promise<TeamCarManagerJson[]> {
  const admins = adminEmailSet(env);
  const seen = new Set<number>();
  const out: TeamCarManagerJson[] = [];
  for (const row of await carManagerRows(db, today)) {
    const id = Number(row.car_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(carManagerJson(row, admins));
  }
  return out;
}

export async function getCarManager(
  db: PortalD1,
  env: PortalEnv,
  carId: number,
  today: string
): Promise<TeamCarManagerJson | null> {
  const rows = await carManagerRows(db, today, carId);
  return rows.length ? carManagerJson(rows[0], adminEmailSet(env)) : null;
}
