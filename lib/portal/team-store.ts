import { randomToken } from "./codec";
import type { PortalD1 } from "./d1";

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

export async function insertWriteLog(
  db: PortalD1,
  entry: {
    agentName: string;
    action: TeamAction;
    carId: number;
    entityId: number;
    before: unknown;
    after: unknown;
  }
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO team_write_log (agent_name, action, car_id, entity_id, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.agentName,
      entry.action,
      entry.carId,
      entry.entityId,
      entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after)
    )
    .run();
  return Number(result.meta.last_row_id);
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
  const result = bounds
    ? await db
        .prepare(
          `SELECT ${INCOME_COLUMNS} FROM trips
           WHERE car_id = ? AND start_date >= ? AND start_date < ? ORDER BY start_date, id`
        )
        .bind(carId, bounds.start, bounds.end)
        .all<IncomeRow>()
    : await db
        .prepare(`SELECT ${INCOME_COLUMNS} FROM trips WHERE car_id = ? ORDER BY start_date, id`)
        .bind(carId)
        .all<IncomeRow>();
  return result.results;
}

export async function getIncome(db: PortalD1, carId: number, id: number): Promise<IncomeRow | null> {
  return db
    .prepare(`SELECT ${INCOME_COLUMNS} FROM trips WHERE id = ? AND car_id = ?`)
    .bind(id, carId)
    .first<IncomeRow>();
}

export async function insertManualIncome(
  db: PortalD1,
  carId: number,
  income: IncomeWrite
): Promise<number> {
  const externalId = `manual-${randomToken(9)}`;
  const result = await db
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
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateManualIncome(
  db: PortalD1,
  carId: number,
  id: number,
  income: IncomeWrite
): Promise<void> {
  await db
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
    )
    .run();
}

export async function deleteManualIncome(db: PortalD1, carId: number, id: number): Promise<void> {
  await db
    .prepare(`DELETE FROM trips WHERE id = ? AND car_id = ? AND platform = ?`)
    .bind(id, carId, MANUAL_PLATFORM)
    .run();
}
