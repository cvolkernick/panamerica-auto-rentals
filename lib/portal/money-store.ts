import type { PortalD1 } from "./d1";
import type { ExpenseCategory } from "./expenses";
import { plateFallbackText } from "./import/wheelbase";
import type { ExpenseWrite } from "./validate";

export type ImportStatus = "preview" | "committed" | "discarded";
export type MatchStatus = "matched" | "unmatched" | "ambiguous" | "invalid";

export type ImportRow = {
  id: number;
  platform: string;
  original_filename: string;
  row_count: number;
  status: ImportStatus;
  created_at: string;
  created_by: number;
  committed_at: string | null;
};

export type ImportLineRow = {
  id: number;
  import_id: number;
  row_number: number;
  external_trip_id: string | null;
  external_vehicle_id: string | null;
  vin: string | null;
  plate: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  status_raw: string | null;
  gross_cents: number | null;
  platform_fees_cents: number | null;
  payout_cents: number | null;
  tax_cents: number | null;
  pending_payout_cents: number | null;
  has_pending: number;
  counts_as_income: number;
  match_status: MatchStatus;
  car_id: number | null;
  error: string | null;
};

export type ReviewRow = {
  id: number;
  import_id: number;
  row_number: number | null;
  kind: "unknown_type" | "unmatched_booking" | "unparsed";
  external_trip_id: string | null;
  type_raw: string | null;
  detail: string;
};

export type ExpenseRow = {
  id: number;
  car_id: number;
  entry_date: string;
  category: ExpenseCategory;
  amount_cents: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: number;
};

export type ReportTripRow = {
  id: number;
  platform: string;
  external_trip_id: string;
  start_at: string | null;
  end_at: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  counts_as_income: number;
  gross_cents: number | null;
  platform_fees_cents: number | null;
  payout_cents: number;
  tax_cents: number | null;
  pending_payout_cents: number | null;
  has_pending: number;
};

type SumRow = {
  trip_count: number;
  payout_cents: number;
  tax_cents: number | null;
  gross_cents: number | null;
  platform_fees_cents: number | null;
  pending_payout_cents: number;
  pending_trip_count: number;
};

type PlatformSumRow = {
  platform: string;
  payout_cents: number;
  tax_cents: number | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function filenameOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "upload.csv";
  const cleaned = base.replace(/[^\w.\- ()+,]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "upload.csv").slice(0, 80);
}

export function importFilename(parts: string[]): string {
  const text = parts.map(filenameOf).join(" + ");
  return text.slice(0, 180) || "upload.csv";
}

export async function insertTripImport(
  db: PortalD1,
  platform: string,
  filename: string,
  rowCount: number,
  actorId: number
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO trip_imports (platform, original_filename, row_count, status, created_by)
       VALUES (?, ?, ?, 'preview', ?)`
    )
    .bind(platform, filename, rowCount, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

export async function insertTripImportRow(
  db: PortalD1,
  importId: number,
  row: {
    rowNumber: number;
    externalTripId: string | null;
    externalVehicleId: string | null;
    vin: string | null;
    plate: string | null;
    startAt: string | null;
    endAt: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    grossCents: number | null;
    platformFeesCents: number | null;
    payoutCents: number | null;
    taxCents: number | null;
    pendingPayoutCents: number | null;
    hasPending: boolean;
    countsAsIncome: boolean;
    matchStatus: MatchStatus;
    carId: number | null;
    error: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trip_import_rows (
         import_id, row_number, external_trip_id, external_vehicle_id, vin, plate,
         start_at, end_at, start_date, end_date, status_raw, gross_cents,
         platform_fees_cents, payout_cents, tax_cents, pending_payout_cents,
         has_pending, counts_as_income, match_status, car_id, error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      importId,
      row.rowNumber,
      row.externalTripId,
      row.externalVehicleId,
      row.vin,
      row.plate,
      row.startAt,
      row.endAt,
      row.startDate,
      row.endDate,
      row.status,
      row.grossCents,
      row.platformFeesCents,
      row.payoutCents,
      row.taxCents,
      row.pendingPayoutCents,
      row.hasPending ? 1 : 0,
      row.countsAsIncome ? 1 : 0,
      row.matchStatus,
      row.carId,
      row.error
    )
    .run();
}

export async function insertReviewItem(
  db: PortalD1,
  importId: number,
  item: {
    rowNumber: number | null;
    kind: ReviewRow["kind"];
    externalTripId: string | null;
    typeRaw: string | null;
    detail: Record<string, string>;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO import_review_items (
         import_id, row_number, kind, external_trip_id, type_raw, detail
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      importId,
      item.rowNumber,
      item.kind,
      item.externalTripId,
      item.typeRaw,
      JSON.stringify(item.detail)
    )
    .run();
}

export async function getTripImport(db: PortalD1, id: number): Promise<ImportRow | null> {
  return db
    .prepare(
      `SELECT id, platform, original_filename, row_count, status, created_at, created_by, committed_at
       FROM trip_imports WHERE id = ?`
    )
    .bind(id)
    .first<ImportRow>();
}

export async function listTripImports(db: PortalD1): Promise<ImportRow[]> {
  const result = await db
    .prepare(
      `SELECT id, platform, original_filename, row_count, status, created_at, created_by, committed_at
       FROM trip_imports ORDER BY id DESC LIMIT 50`
    )
    .bind()
    .all<ImportRow>();
  return result.results;
}

export async function listImportLines(db: PortalD1, importId: number): Promise<ImportLineRow[]> {
  const result = await db
    .prepare(
      `SELECT id, import_id, row_number, external_trip_id, external_vehicle_id, vin, plate,
              start_at, end_at, start_date, end_date, status_raw, gross_cents, platform_fees_cents,
              payout_cents, tax_cents, pending_payout_cents, has_pending, counts_as_income,
              match_status, car_id, error
       FROM trip_import_rows WHERE import_id = ? ORDER BY row_number, id`
    )
    .bind(importId)
    .all<ImportLineRow>();
  return result.results;
}

export async function listReviewItems(db: PortalD1, importId: number): Promise<ReviewRow[]> {
  const result = await db
    .prepare(
      `SELECT id, import_id, row_number, kind, external_trip_id, type_raw, detail
       FROM import_review_items WHERE import_id = ? ORDER BY id`
    )
    .bind(importId)
    .all<ReviewRow>();
  return result.results;
}

export async function rememberPlatformVehicle(
  db: PortalD1,
  carId: number,
  platform: string,
  externalVehicleId: string,
  actorId: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO car_platform_ids (car_id, platform, external_vehicle_id, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(platform, external_vehicle_id) DO UPDATE SET
         car_id = excluded.car_id,
         created_by = excluded.created_by`
    )
    .bind(carId, platform, externalVehicleId, actorId)
    .run();
}

export async function assignImportLine(
  db: PortalD1,
  importId: number,
  rowId: number,
  carId: number,
  actorId: number
): Promise<"ok" | "missing" | "closed" | "car"> {
  const header = await getTripImport(db, importId);
  if (!header) return "missing";
  if (header.status !== "preview") return "closed";
  const line = await db
    .prepare(
      `SELECT id, external_vehicle_id FROM trip_import_rows WHERE id = ? AND import_id = ?`
    )
    .bind(rowId, importId)
    .first<{ id: number; external_vehicle_id: string | null }>();
  if (!line) return "missing";
  const car = await db.prepare(`SELECT id FROM cars WHERE id = ?`).bind(carId).first<{ id: number }>();
  if (!car) return "car";
  await db
    .prepare(
      `UPDATE trip_import_rows
       SET car_id = ?, match_status = 'matched', error = NULL
       WHERE id = ? AND import_id = ?`
    )
    .bind(carId, rowId, importId)
    .run();
  if (line.external_vehicle_id) {
    await rememberPlatformVehicle(db, carId, header.platform, line.external_vehicle_id, actorId);
  }
  return "ok";
}

export async function skipImportLine(
  db: PortalD1,
  importId: number,
  rowId: number
): Promise<"ok" | "missing" | "closed"> {
  const header = await getTripImport(db, importId);
  if (!header) return "missing";
  if (header.status !== "preview") return "closed";
  const result = await db
    .prepare(
      `UPDATE trip_import_rows
       SET match_status = 'invalid', car_id = NULL, error = 'skipped', counts_as_income = 0
       WHERE id = ? AND import_id = ?`
    )
    .bind(rowId, importId)
    .run();
  return result.meta.changes > 0 ? "ok" : "missing";
}

export async function discardImportLine(
  db: PortalD1,
  importId: number,
  rowId: number
): Promise<"ok" | "missing" | "closed" | "not_invalid"> {
  const header = await getTripImport(db, importId);
  if (!header) return "missing";
  if (header.status !== "preview") return "closed";
  const line = await db
    .prepare(`SELECT match_status FROM trip_import_rows WHERE id = ? AND import_id = ?`)
    .bind(rowId, importId)
    .first<{ match_status: MatchStatus }>();
  if (!line) return "missing";
  if (line.match_status !== "invalid") return "not_invalid";
  await db
    .prepare(`DELETE FROM trip_import_rows WHERE id = ? AND import_id = ?`)
    .bind(rowId, importId)
    .run();
  return "ok";
}

export async function discardTripImport(
  db: PortalD1,
  importId: number
): Promise<"ok" | "missing" | "closed"> {
  const header = await getTripImport(db, importId);
  if (!header) return "missing";
  if (header.status !== "preview") return "closed";
  await db
    .prepare(`UPDATE trip_imports SET status = 'discarded' WHERE id = ?`)
    .bind(importId)
    .run();
  return "ok";
}

export async function commitTripImport(
  db: PortalD1,
  importId: number,
  actorId: number
): Promise<"ok" | "missing" | "closed" | "unresolved" | "bad_row"> {
  const header = await getTripImport(db, importId);
  if (!header) return "missing";
  if (header.status !== "preview") return "closed";
  const lines = await listImportLines(db, importId);
  if (lines.some((line) => line.match_status === "unmatched" || line.match_status === "ambiguous")) {
    return "unresolved";
  }
  const ready = lines.filter((line) => line.match_status === "matched");
  for (const line of ready) {
    if (
      line.car_id === null ||
      line.payout_cents === null ||
      !line.start_date ||
      !line.status_raw ||
      !line.external_trip_id
    ) {
      return "bad_row";
    }
  }
  for (const line of ready) {
    await db
      .prepare(
        `INSERT INTO trips (
           car_id, platform, external_trip_id, start_at, end_at, start_date, end_date,
           status, counts_as_income, gross_cents, platform_fees_cents, payout_cents,
           tax_cents, pending_payout_cents, has_pending, import_id, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')
         )
         ON CONFLICT(platform, external_trip_id) DO UPDATE SET
           car_id = excluded.car_id,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           status = excluded.status,
           counts_as_income = excluded.counts_as_income,
           gross_cents = excluded.gross_cents,
           platform_fees_cents = excluded.platform_fees_cents,
           payout_cents = excluded.payout_cents,
           tax_cents = excluded.tax_cents,
           pending_payout_cents = excluded.pending_payout_cents,
           has_pending = excluded.has_pending,
           import_id = excluded.import_id,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      )
      .bind(
        line.car_id,
        header.platform,
        line.external_trip_id,
        line.start_at,
        line.end_at,
        line.start_date,
        line.end_date,
        line.status_raw,
        line.counts_as_income ? 1 : 0,
        line.gross_cents,
        line.platform_fees_cents,
        line.payout_cents,
        line.tax_cents,
        line.pending_payout_cents,
        line.has_pending ? 1 : 0,
        importId
      )
      .run();
    if (line.external_vehicle_id && line.car_id !== null) {
      await rememberPlatformVehicle(db, line.car_id, header.platform, line.external_vehicle_id, actorId);
    }
  }
  await db
    .prepare(
      `UPDATE trip_imports
       SET status = 'committed', committed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    )
    .bind(importId)
    .run();
  return "ok";
}

function lineJson(row: ImportLineRow) {
  return {
    id: Number(row.id),
    rowNumber: Number(row.row_number),
    externalTripId: row.external_trip_id,
    externalVehicleId: row.external_vehicle_id,
    vin: row.vin,
    plate: row.plate,
    plateFallback: plateFallbackText(row.plate),
    startAt: row.start_at,
    endAt: row.end_at,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status_raw,
    grossCents: num(row.gross_cents),
    platformFeesCents: num(row.platform_fees_cents),
    payoutCents: num(row.payout_cents),
    taxCents: num(row.tax_cents),
    pendingPayoutCents: num(row.pending_payout_cents),
    hasPending: Number(row.has_pending) === 1,
    countsAsIncome: Number(row.counts_as_income) === 1,
    matchStatus: row.match_status,
    carId: row.car_id === null ? null : Number(row.car_id),
    error: row.error,
  };
}

function reviewJson(row: ReviewRow) {
  let detail: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.detail) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") detail[key] = value;
      }
    }
  } catch {
    detail = {};
  }
  return {
    id: Number(row.id),
    rowNumber: row.row_number === null ? null : Number(row.row_number),
    kind: row.kind,
    externalTripId: row.external_trip_id,
    typeRaw: row.type_raw,
    detail,
  };
}

export async function importReviewPayload(db: PortalD1, id: number) {
  const header = await getTripImport(db, id);
  if (!header) return null;
  const lines = await listImportLines(db, id);
  const reviews = await listReviewItems(db, id);
  const mapped = lines.map(lineJson);
  const count = (status: MatchStatus) => mapped.filter((line) => line.matchStatus === status).length;
  return {
    import: {
      id: Number(header.id),
      platform: header.platform,
      filename: header.original_filename,
      rowCount: Number(header.row_count),
      status: header.status,
      createdAt: header.created_at,
      committedAt: header.committed_at,
      counts: {
        total: mapped.length,
        matched: count("matched"),
        unmatched: count("unmatched"),
        ambiguous: count("ambiguous"),
        invalid: count("invalid"),
      },
    },
    rows: mapped,
    unmatched: mapped.filter((line) => line.matchStatus === "unmatched"),
    ambiguous: mapped.filter((line) => line.matchStatus === "ambiguous"),
    invalid: mapped.filter((line) => line.matchStatus === "invalid"),
    reviewItems: reviews.map(reviewJson),
  };
}

export async function insertExpense(
  db: PortalD1,
  carId: number,
  expense: ExpenseWrite,
  actorId: number
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO expenses (car_id, entry_date, category, amount_cents, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(carId, expense.entryDate, expense.category, expense.amountCents, expense.note, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateExpense(
  db: PortalD1,
  carId: number,
  expenseId: number,
  expense: ExpenseWrite
): Promise<void> {
  await db
    .prepare(
      `UPDATE expenses
       SET entry_date = ?, category = ?, amount_cents = ?, note = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND car_id = ?`
    )
    .bind(expense.entryDate, expense.category, expense.amountCents, expense.note, expenseId, carId)
    .run();
}

export async function deleteExpense(db: PortalD1, carId: number, expenseId: number): Promise<void> {
  await db.prepare(`DELETE FROM expenses WHERE id = ? AND car_id = ?`).bind(expenseId, carId).run();
}

export async function getExpense(
  db: PortalD1,
  carId: number,
  expenseId: number
): Promise<ExpenseRow | null> {
  return db
    .prepare(
      `SELECT id, car_id, entry_date, category, amount_cents, note, created_at, updated_at, created_by
       FROM expenses WHERE id = ? AND car_id = ?`
    )
    .bind(expenseId, carId)
    .first<ExpenseRow>();
}

export async function listExpenses(
  db: PortalD1,
  carId: number,
  bounds?: { start: string; end: string }
): Promise<ExpenseRow[]> {
  const sql = bounds
    ? `SELECT id, car_id, entry_date, category, amount_cents, note, created_at, updated_at, created_by
       FROM expenses WHERE car_id = ? AND entry_date >= ? AND entry_date < ? ORDER BY entry_date, id`
    : `SELECT id, car_id, entry_date, category, amount_cents, note, created_at, updated_at, created_by
       FROM expenses WHERE car_id = ? ORDER BY entry_date, id`;
  const statement = db.prepare(sql);
  const result = bounds
    ? await statement.bind(carId, bounds.start, bounds.end).all<ExpenseRow>()
    : await statement.bind(carId).all<ExpenseRow>();
  return result.results;
}

export function expenseJson(row: ExpenseRow) {
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    entryDate: row.entry_date,
    category: row.category,
    amountCents: Number(row.amount_cents),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: Number(row.created_by),
  };
}

const TRIP_SUM_SQL = `SELECT
  COUNT(*) AS trip_count,
  COALESCE(SUM(payout_cents), 0) AS payout_cents,
  SUM(tax_cents) AS tax_cents,
  SUM(gross_cents) AS gross_cents,
  SUM(platform_fees_cents) AS platform_fees_cents,
  COALESCE(SUM(CASE WHEN has_pending = 1 THEN COALESCE(pending_payout_cents, 0) ELSE 0 END), 0) AS pending_payout_cents,
  COALESCE(SUM(CASE WHEN has_pending = 1 THEN 1 ELSE 0 END), 0) AS pending_trip_count
FROM trips
WHERE car_id = ? AND counts_as_income = 1`;

function totalsFrom(sum: SumRow | null, expenseCents: number) {
  const tripCount = Number(sum?.trip_count ?? 0);
  const payoutCents = Number(sum?.payout_cents ?? 0);
  const taxCents = tripCount === 0 || sum?.tax_cents === null || sum?.tax_cents === undefined
    ? null
    : Number(sum.tax_cents);
  const incomeCents = payoutCents - (taxCents ?? 0);
  return {
    payoutCents,
    taxCents,
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    grossCents: tripCount === 0 || sum?.gross_cents === null || sum?.gross_cents === undefined
      ? null
      : Number(sum.gross_cents),
    platformFeesCents:
      tripCount === 0 || sum?.platform_fees_cents === null || sum?.platform_fees_cents === undefined
        ? null
        : Number(sum.platform_fees_cents),
    pendingPayoutCents: Number(sum?.pending_payout_cents ?? 0),
    pendingTripCount: Number(sum?.pending_trip_count ?? 0),
  };
}

async function expenseSum(
  db: PortalD1,
  carId: number,
  bounds?: { start?: string; end: string }
): Promise<number> {
  if (bounds?.start && bounds.end) {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS expense_cents
         FROM expenses WHERE car_id = ? AND entry_date >= ? AND entry_date < ?`
      )
      .bind(carId, bounds.start, bounds.end)
      .first<{ expense_cents: number }>();
    return Number(row?.expense_cents ?? 0);
  }
  if (bounds?.end) {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS expense_cents
         FROM expenses WHERE car_id = ? AND entry_date < ?`
      )
      .bind(carId, bounds.end)
      .first<{ expense_cents: number }>();
    return Number(row?.expense_cents ?? 0);
  }
  const row = await db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS expense_cents FROM expenses WHERE car_id = ?`)
    .bind(carId)
    .first<{ expense_cents: number }>();
  return Number(row?.expense_cents ?? 0);
}

async function tripSum(
  db: PortalD1,
  carId: number,
  bounds?: { start?: string; end: string }
): Promise<SumRow | null> {
  if (bounds?.start && bounds.end) {
    return db
      .prepare(`${TRIP_SUM_SQL} AND start_date >= ? AND start_date < ?`)
      .bind(carId, bounds.start, bounds.end)
      .first<SumRow>();
  }
  if (bounds?.end) {
    return db
      .prepare(`${TRIP_SUM_SQL} AND start_date < ?`)
      .bind(carId, bounds.end)
      .first<SumRow>();
  }
  return db.prepare(TRIP_SUM_SQL).bind(carId).first<SumRow>();
}

export async function carMoneyReport(db: PortalD1, carId: number, month: string, bounds: { start: string; end: string }) {
  const [monthSum, toDateSum, allSum, monthExpenses, toDateExpenses, allExpenses, trips, expenses, platforms] =
    await Promise.all([
      tripSum(db, carId, bounds),
      tripSum(db, carId, { end: bounds.end }),
      tripSum(db, carId),
      expenseSum(db, carId, bounds),
      expenseSum(db, carId, { end: bounds.end }),
      expenseSum(db, carId),
      db
        .prepare(
          `SELECT id, platform, external_trip_id, start_at, end_at, start_date, end_date, status,
                  counts_as_income, gross_cents, platform_fees_cents, payout_cents, tax_cents,
                  pending_payout_cents, has_pending
           FROM trips
           WHERE car_id = ? AND start_date >= ? AND start_date < ?
           ORDER BY start_date, id`
        )
        .bind(carId, bounds.start, bounds.end)
        .all<ReportTripRow>(),
      listExpenses(db, carId, bounds),
      db
        .prepare(
          `SELECT platform, COALESCE(SUM(payout_cents), 0) AS payout_cents, SUM(tax_cents) AS tax_cents
           FROM trips
           WHERE car_id = ? AND counts_as_income = 1 AND start_date >= ? AND start_date < ?
           GROUP BY platform
           ORDER BY platform`
        )
        .bind(carId, bounds.start, bounds.end)
        .all<PlatformSumRow>(),
    ]);

  return {
    month,
    attribution: "A trip counts entirely in the month it starts. Trips are not split across months.",
    monthTotals: totalsFrom(monthSum, monthExpenses),
    toDate: totalsFrom(toDateSum, toDateExpenses),
    allTime: totalsFrom(allSum, allExpenses),
    platforms: platforms.results.map((row) => {
      const payoutCents = Number(row.payout_cents);
      const taxCents = row.tax_cents === null || row.tax_cents === undefined ? null : Number(row.tax_cents);
      return {
        platform: row.platform,
        payoutCents,
        taxCents,
        incomeCents: payoutCents - (taxCents ?? 0),
      };
    }),
    trips: trips.results.map((row) => ({
      id: Number(row.id),
      platform: row.platform,
      externalTripId: row.external_trip_id,
      startAt: row.start_at,
      endAt: row.end_at,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      countsAsIncome: Number(row.counts_as_income) === 1,
      grossCents: num(row.gross_cents),
      platformFeesCents: num(row.platform_fees_cents),
      payoutCents: Number(row.payout_cents),
      taxCents: num(row.tax_cents),
      pendingPayoutCents: num(row.pending_payout_cents),
      hasPending: Number(row.has_pending) === 1,
    })),
    expenses: expenses.map(expenseJson),
  };
}

export async function carDeleteConflict(
  db: PortalD1,
  carId: number
): Promise<"car_has_trips" | "car_has_expenses" | "car_has_payouts" | null> {
  const trips = await db
    .prepare(`SELECT 1 AS ok FROM trips WHERE car_id = ? LIMIT 1`)
    .bind(carId)
    .first<{ ok: number }>();
  if (trips) return "car_has_trips";
  const expenses = await db
    .prepare(`SELECT 1 AS ok FROM expenses WHERE car_id = ? LIMIT 1`)
    .bind(carId)
    .first<{ ok: number }>();
  if (expenses) return "car_has_expenses";
  const payouts = await db
    .prepare(`SELECT 1 AS ok FROM payouts WHERE car_id = ? LIMIT 1`)
    .bind(carId)
    .first<{ ok: number }>();
  if (payouts) return "car_has_payouts";
  return null;
}
