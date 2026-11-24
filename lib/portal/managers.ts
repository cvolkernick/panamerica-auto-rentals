/**
 * Manager role, phase 1 (docs/manager-role.md).
 *
 * - An admin creates managers and sets each one's share of the company fee, in basis points.
 * - An admin assigns cars to managers. Each car has at most one manager at a time, and the
 *   assignment history is kept with start (inclusive) and end (exclusive) dates.
 * - A manager's accrued share is figured per trip: the trip's management fee (the tier fee on
 *   the platform's actual net payout, from statement.ts) times the manager's share, rounded
 *   half up to the cent. A trip belongs to whoever managed the car on the trip's start date.
 *
 * Read-only on money: nothing here changes owner statements, expenses, or payouts.
 */
import type { PortalD1 } from "./d1";
import { feeForTrip, type StatementTripInput } from "./statement";

export const MANAGER_NAME_MAX = 80;
export const MAX_SHARE_BPS = 10000;

export type ManagerRow = {
  id: number;
  name: string;
  share_bps: number;
  created_at: string;
  updated_at: string;
};

export type AssignmentRow = {
  id: number;
  car_id: number;
  manager_id: number;
  start_date: string;
  end_date: string | null;
  created_at: string;
  manager_name?: string;
  car_year?: number;
  car_make?: string;
  car_model?: string;
  car_license_plate?: string;
};

export type ManagerWrite = { name: string; shareBps: number };
export type ManagerPatch = Partial<ManagerWrite>;
export type AssignmentWrite = { managerId: number | null; startDate: string };

type FieldErrors = Record<string, string>;
type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1980 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseName(value: unknown, fields: FieldErrors): string | undefined {
  if (typeof value !== "string") {
    fields.name = "Enter a name.";
    return;
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > MANAGER_NAME_MAX || /[\u0000-\u001F]/.test(text)) {
    fields.name = `Use 1 to ${MANAGER_NAME_MAX} characters.`;
    return;
  }
  if (/@/.test(text) || /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(text)) {
    fields.name = "Use a name only, no email or phone.";
    return;
  }
  return text;
}

function parseShareBps(value: unknown, fields: FieldErrors): number | undefined {
  let bps: number;
  if (typeof value === "number") bps = value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) bps = Number(value.trim());
  else {
    fields.shareBps = "Enter the share as whole basis points (1250 = 12.5%).";
    return;
  }
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > MAX_SHARE_BPS) {
    fields.shareBps = "Use 0 to 10000 basis points (0% to 100%).";
    return;
  }
  return bps;
}

/** "12.5" or "12.50" percent -> 1250 bps. Up to two decimals. null if not a valid percent. */
export function percentToBps(raw: string): number | null {
  const text = raw.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bps <= MAX_SHARE_BPS ? bps : null;
}

export function bpsToPercentLabel(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

export function parseManagerCreate(body: unknown): Parsed<ManagerWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  const name = parseName(body.name, fields);
  const shareBps = parseShareBps(body.shareBps, fields);
  if (Object.keys(fields).length > 0 || name === undefined || shareBps === undefined) {
    return { ok: false, fields };
  }
  return { ok: true, value: { name, shareBps } };
}

export function parseManagerPatch(body: unknown): Parsed<ManagerPatch> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  const value: ManagerPatch = {};
  if ("name" in body) value.name = parseName(body.name, fields);
  if ("shareBps" in body) value.shareBps = parseShareBps(body.shareBps, fields);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (value.name === undefined && value.shareBps === undefined) {
    return { ok: false, fields: { body: "Nothing to update." } };
  }
  return { ok: true, value };
}

export function parseAssignment(body: unknown): Parsed<AssignmentWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  let managerId: number | null | undefined;
  if (body.managerId === null) managerId = null;
  else if (typeof body.managerId === "number" && Number.isSafeInteger(body.managerId) && body.managerId > 0) {
    managerId = body.managerId;
  } else if (typeof body.managerId === "string" && /^[1-9]\d*$/.test(body.managerId)) {
    managerId = Number(body.managerId);
  } else {
    fields.managerId = "Choose a manager, or null to unassign.";
  }
  if (!isRealDate(body.startDate)) fields.startDate = "Use a real date as YYYY-MM-DD.";
  if (Object.keys(fields).length > 0 || managerId === undefined) return { ok: false, fields };
  return { ok: true, value: { managerId, startDate: body.startDate as string } };
}

/** Share of one trip's fee, in cents, rounded half up. */
export function managerShareCents(feeCents: number, shareBps: number): number {
  if (!Number.isSafeInteger(feeCents) || !Number.isSafeInteger(shareBps)) throw new Error("integer cents only");
  if (feeCents <= 0 || shareBps <= 0) return 0;
  return Math.floor((feeCents * shareBps + 5000) / 10000);
}

/** True when the assignment [start, end) covers the date. */
export function assignmentCovers(assignment: { start_date: string; end_date: string | null }, date: string): boolean {
  return date >= assignment.start_date && (assignment.end_date === null || date < assignment.end_date);
}

export type AccrualTrip = {
  carId: number;
  assignmentId: number;
  tripId: number;
  platform: string;
  startDate: string;
  endDate: string | null;
  days: number;
  feeRateBps: number;
  incomeCents: number;
  feeCents: number;
  shareCents: number;
};

export type AccrualMonth = { month: string; tripCount: number; feeCents: number; shareCents: number };
export type AccrualCar = { carId: number; tripCount: number; feeCents: number; shareCents: number };

export type ManagerAccrual = {
  shareBps: number;
  tripCount: number;
  feeCents: number;
  accruedCents: number;
  months: AccrualMonth[];
  cars: AccrualCar[];
  trips: AccrualTrip[];
};

/**
 * Pure. Trips per car come in with the statement input shape. Only trips that count as
 * income earn a fee, so only those earn a share.
 */
export function buildManagerAccrual(input: {
  shareBps: number;
  assignments: { id: number; car_id: number; start_date: string; end_date: string | null }[];
  tripsByCar: Map<number, StatementTripInput[]>;
}): ManagerAccrual {
  const trips: AccrualTrip[] = [];
  for (const assignment of input.assignments) {
    const carId = Number(assignment.car_id);
    for (const trip of input.tripsByCar.get(carId) ?? []) {
      if (!trip.countsAsIncome || !assignmentCovers(assignment, trip.startDate)) continue;
      const fee = feeForTrip(trip);
      if (fee.feeCents <= 0) continue;
      trips.push({
        carId,
        assignmentId: Number(assignment.id),
        tripId: trip.id,
        platform: trip.platform,
        startDate: trip.startDate,
        endDate: trip.endDate,
        days: fee.days,
        feeRateBps: fee.feeRateBps,
        incomeCents: trip.incomeCents,
        feeCents: fee.feeCents,
        shareCents: managerShareCents(fee.feeCents, input.shareBps),
      });
    }
  }
  trips.sort((a, b) => (a.startDate === b.startDate ? a.tripId - b.tripId : a.startDate < b.startDate ? -1 : 1));
  const months = new Map<string, AccrualMonth>();
  const cars = new Map<number, AccrualCar>();
  for (const trip of trips) {
    const month = trip.startDate.slice(0, 7);
    const m = months.get(month) ?? { month, tripCount: 0, feeCents: 0, shareCents: 0 };
    m.tripCount += 1;
    m.feeCents += trip.feeCents;
    m.shareCents += trip.shareCents;
    months.set(month, m);
    const c = cars.get(trip.carId) ?? { carId: trip.carId, tripCount: 0, feeCents: 0, shareCents: 0 };
    c.tripCount += 1;
    c.feeCents += trip.feeCents;
    c.shareCents += trip.shareCents;
    cars.set(trip.carId, c);
  }
  return {
    shareBps: input.shareBps,
    tripCount: trips.length,
    feeCents: trips.reduce((sum, trip) => sum + trip.feeCents, 0),
    accruedCents: trips.reduce((sum, trip) => sum + trip.shareCents, 0),
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    cars: [...cars.values()].sort((a, b) => a.carId - b.carId),
    trips,
  };
}

/**
 * Decides how one assignment write changes a car's history, given its rows (any order).
 * Rules: the new date must be on or after the start of the open assignment (strictly after
 * when it closes one), and on or after the latest end date when the car is unassigned.
 */
export function planAssignment(
  history: { id: number; manager_id: number; start_date: string; end_date: string | null }[],
  write: AssignmentWrite
):
  | { ok: true; close: { id: number; endDate: string } | null; open: { managerId: number; startDate: string } | null }
  | { ok: false; fields: FieldErrors } {
  const open = history.find((row) => row.end_date === null) ?? null;
  const latestEnd = history
    .map((row) => row.end_date)
    .filter((date): date is string => date !== null)
    .sort()
    .pop();
  if (open) {
    if (write.managerId !== null && Number(open.manager_id) === write.managerId) {
      return { ok: false, fields: { managerId: "That manager already has this car." } };
    }
    if (write.startDate <= open.start_date) {
      return {
        ok: false,
        fields: { startDate: `Use a date after ${open.start_date}, when the current manager started.` },
      };
    }
    return {
      ok: true,
      close: { id: Number(open.id), endDate: write.startDate },
      open: write.managerId === null ? null : { managerId: write.managerId, startDate: write.startDate },
    };
  }
  if (write.managerId === null) return { ok: false, fields: { managerId: "This car has no manager to remove." } };
  if (latestEnd && write.startDate < latestEnd) {
    return { ok: false, fields: { startDate: `Use ${latestEnd} or later, when the last manager ended.` } };
  }
  return { ok: true, close: null, open: { managerId: write.managerId, startDate: write.startDate } };
}

// ---------- store ----------

const MANAGER_COLUMNS = "id, name, share_bps, created_at, updated_at";
const ASSIGNMENT_SELECT = `SELECT a.id, a.car_id, a.manager_id, a.start_date, a.end_date, a.created_at,
       m.name AS manager_name, c.year AS car_year, c.make AS car_make, c.model AS car_model,
       c.license_plate AS car_license_plate
  FROM car_manager_assignments a
  JOIN managers m ON m.id = a.manager_id
  JOIN cars c ON c.id = a.car_id`;

export async function listManagers(db: PortalD1): Promise<ManagerRow[]> {
  const result = await db.prepare(`SELECT ${MANAGER_COLUMNS} FROM managers ORDER BY name, id`).all<ManagerRow>();
  return result.results;
}

export async function getManager(db: PortalD1, id: number): Promise<ManagerRow | null> {
  return db.prepare(`SELECT ${MANAGER_COLUMNS} FROM managers WHERE id = ?`).bind(id).first<ManagerRow>();
}

export async function insertManager(db: PortalD1, write: ManagerWrite, actorId: number): Promise<number> {
  const result = await db
    .prepare(`INSERT INTO managers (name, share_bps, created_by) VALUES (?, ?, ?)`)
    .bind(write.name, write.shareBps, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateManager(db: PortalD1, id: number, write: ManagerWrite): Promise<void> {
  await db
    .prepare(
      `UPDATE managers SET name = ?, share_bps = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    )
    .bind(write.name, write.shareBps, id)
    .run();
}

export async function listAssignmentsForCar(db: PortalD1, carId: number): Promise<AssignmentRow[]> {
  const result = await db
    .prepare(`${ASSIGNMENT_SELECT} WHERE a.car_id = ? ORDER BY a.start_date DESC, a.id DESC`)
    .bind(carId)
    .all<AssignmentRow>();
  return result.results;
}

export async function listAssignmentsForManager(db: PortalD1, managerId: number): Promise<AssignmentRow[]> {
  const result = await db
    .prepare(`${ASSIGNMENT_SELECT} WHERE a.manager_id = ? ORDER BY a.start_date DESC, a.id DESC`)
    .bind(managerId)
    .all<AssignmentRow>();
  return result.results;
}

export async function listAllAssignments(db: PortalD1): Promise<AssignmentRow[]> {
  const result = await db
    .prepare(`${ASSIGNMENT_SELECT} ORDER BY a.car_id, a.start_date DESC, a.id DESC`)
    .all<AssignmentRow>();
  return result.results;
}

export async function closeAssignment(db: PortalD1, id: number, endDate: string): Promise<void> {
  await db
    .prepare(`UPDATE car_manager_assignments SET end_date = ? WHERE id = ? AND end_date IS NULL`)
    .bind(endDate, id)
    .run();
}

export async function reopenAssignment(db: PortalD1, id: number): Promise<void> {
  await db.prepare(`UPDATE car_manager_assignments SET end_date = NULL WHERE id = ?`).bind(id).run();
}

export async function insertAssignment(
  db: PortalD1,
  carId: number,
  managerId: number,
  startDate: string,
  actorId: number
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO car_manager_assignments (car_id, manager_id, start_date, created_by) VALUES (?, ?, ?, ?)`
    )
    .bind(carId, managerId, startDate, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

export async function deleteAssignment(db: PortalD1, carId: number, id: number): Promise<void> {
  await db.prepare(`DELETE FROM car_manager_assignments WHERE id = ? AND car_id = ?`).bind(id, carId).run();
}

type TripRow = {
  id: number;
  car_id: number;
  platform: string;
  external_trip_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  counts_as_income: number;
  payout_cents: number;
  tax_cents: number | null;
  pending_payout_cents: number | null;
  has_pending: number;
};

/** Same income rule as statement-store: counted income = payout minus pass-through tax. */
export async function tripsForCars(db: PortalD1, carIds: number[]): Promise<Map<number, StatementTripInput[]>> {
  const map = new Map<number, StatementTripInput[]>();
  for (const carId of [...new Set(carIds)]) {
    const result = await db
      .prepare(
        `SELECT id, car_id, platform, external_trip_id, start_date, end_date, status, counts_as_income,
                payout_cents, tax_cents, pending_payout_cents, has_pending
           FROM trips WHERE car_id = ? ORDER BY start_date, id`
      )
      .bind(carId)
      .all<TripRow>();
    map.set(
      carId,
      result.results.map((row) => ({
        id: Number(row.id),
        platform: row.platform,
        externalTripId: row.external_trip_id,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        countsAsIncome: Number(row.counts_as_income) === 1,
        incomeCents: Number(row.payout_cents) - (row.tax_cents === null ? 0 : Number(row.tax_cents)),
        hasPending: Number(row.has_pending) === 1,
        pendingPayoutCents: row.pending_payout_cents === null ? null : Number(row.pending_payout_cents),
      }))
    );
  }
  return map;
}

export async function managerAccrual(db: PortalD1, manager: ManagerRow, assignments: AssignmentRow[]) {
  const tripsByCar = await tripsForCars(
    db,
    assignments.map((row) => Number(row.car_id))
  );
  return buildManagerAccrual({ shareBps: Number(manager.share_bps), assignments, tripsByCar });
}

// ---------- json ----------

export function managerJson(row: ManagerRow) {
  return {
    id: Number(row.id),
    name: row.name,
    shareBps: Number(row.share_bps),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assignmentJson(row: AssignmentRow) {
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    managerId: Number(row.manager_id),
    managerName: row.manager_name ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    current: row.end_date === null,
    car:
      row.car_make !== undefined
        ? {
            id: Number(row.car_id),
            year: Number(row.car_year),
            make: row.car_make,
            model: row.car_model ?? "",
            licensePlate: row.car_license_plate ?? "",
          }
        : null,
    createdAt: row.created_at,
  };
}

export type ManagerJson = ReturnType<typeof managerJson>;
export type AssignmentJson = ReturnType<typeof assignmentJson>;
