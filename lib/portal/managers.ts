/**
 * Manager role, phase 1 (docs/manager-role.md).
 *
 * - An admin creates managers and sets each one's share of the company fee, in basis points.
 *   The share has a dated history (manager_share_rates). A change applies forward only from
 *   its effective date; each trip uses the rate in effect on the trip's start date, so past
 *   accrual is never re-rated. Rates are append-only and must be dated after the latest one.
 *   The one correction allowed: the FIRST rate's start date can move (when the manager actually
 *   started), as long as it stays before the next rate and no assignment starts before it.
 * - An admin assigns cars to managers. Each car has at most one manager at a time, and the
 *   assignment history is kept with start (inclusive) and end (exclusive) dates.
 * - A manager's accrued share is figured per trip: the trip's management fee (the tier fee on
 *   the platform's actual net payout, from statement.ts) times the manager's share, rounded
 *   half up to the cent. A trip belongs to whoever managed the car on the trip's start date.
 *
 * Read-only on money: nothing here changes owner statements, expenses, or payouts.
 */
import type { PortalD1 } from "./d1";
import { normalizeLoginEmail } from "./email";
import { feeForTrip, type StatementTripInput } from "./statement";

export const MANAGER_NAME_MAX = 80;
export const MAX_SHARE_BPS = 10000;

export type ManagerRow = {
  id: number;
  name: string;
  /** Login account (owners.id). Null for a phase-1 row that is not linked yet. Migration 0009. */
  account_id: number | null;
  created_at: string;
  updated_at: string;
  account_email?: string | null;
};

export type RateRow = {
  id: number;
  manager_id: number;
  share_bps: number;
  effective_from: string;
  created_at: string;
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

/** New managers carry an email: the create makes a new login account for it (never links an existing one). */
export type ManagerWrite = { name: string; email: string; shareBps: number; effectiveFrom: string };
export type AccountWrite = { email: string };
export type LinkWrite = { ownerId: number };
export type ManagerFromAccountWrite = { name: string; ownerId: number; shareBps: number; effectiveFrom: string };
export type ManagerPatch = { name: string };
export type RateWrite = { shareBps: number; effectiveFrom: string };
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

function parseEffectiveFrom(value: unknown, fields: FieldErrors): string | undefined {
  if (!isRealDate(value)) {
    fields.effectiveFrom = "Use a real date as YYYY-MM-DD.";
    return;
  }
  return value;
}

function parseAccountEmail(value: unknown, fields: FieldErrors): string | undefined {
  const email = normalizeLoginEmail(value);
  if (!email) {
    fields.email = "Enter the manager's email. It becomes their sign-in.";
    return;
  }
  return email;
}

/**
 * Create seeds the first rate row and a new login account: { name, email, shareBps, effectiveFrom }.
 * Name-only creates are refused (docs/manager-role.md, phase 2 prerequisite).
 */
export function parseManagerCreate(body: unknown): Parsed<ManagerWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  const name = parseName(body.name, fields);
  const email = parseAccountEmail(body.email, fields);
  const shareBps = parseShareBps(body.shareBps, fields);
  const effectiveFrom = parseEffectiveFrom(body.effectiveFrom, fields);
  if (
    Object.keys(fields).length > 0 ||
    name === undefined ||
    email === undefined ||
    shareBps === undefined ||
    effectiveFrom === undefined
  ) {
    return { ok: false, fields };
  }
  return { ok: true, value: { name, email, shareBps, effectiveFrom } };
}

/** { email } for a new login account on an unlinked manager. */
export function parseAccountCreate(body: unknown): Parsed<AccountWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  const email = parseAccountEmail(body.email, fields);
  if (email === undefined) return { ok: false, fields };
  return { ok: true, value: { email } };
}

/**
 * Explicit link to an existing account: { ownerId, confirm: true }. An email is refused here on
 * purpose, so a link can never come from an inferred email match.
 */
export function parseAccountLink(body: unknown): Parsed<LinkWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  if ("email" in body) {
    return { ok: false, fields: { email: "Link by the confirmed account id, not by email." } };
  }
  const fields: FieldErrors = {};
  const raw = body.ownerId;
  let ownerId: number | undefined;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) ownerId = raw;
  else fields.ownerId = "Choose the account to link by its id.";
  if (body.confirm !== true) fields.confirm = "Confirm this exact account before linking.";
  if (Object.keys(fields).length > 0 || ownerId === undefined) return { ok: false, fields };
  return { ok: true, value: { ownerId } };
}

/**
 * New manager on an existing login account (for example an owner who also manages):
 * { name, ownerId, confirm: true, shareBps, effectiveFrom }. Same rule as parseAccountLink: an
 * email is refused, so the account always comes from the admin's explicit, confirmed pick.
 */
export function parseManagerFromAccount(body: unknown): Parsed<ManagerFromAccountWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const link = parseAccountLink(body);
  const fields: FieldErrors = link.ok ? {} : { ...link.fields };
  const name = parseName(body.name, fields);
  const shareBps = parseShareBps(body.shareBps, fields);
  const effectiveFrom = parseEffectiveFrom(body.effectiveFrom, fields);
  if (
    !link.ok ||
    Object.keys(fields).length > 0 ||
    name === undefined ||
    shareBps === undefined ||
    effectiveFrom === undefined
  ) {
    return { ok: false, fields };
  }
  return { ok: true, value: { name, ownerId: link.value.ownerId, shareBps, effectiveFrom } };
}

/** Name only. The share changes through a dated rate (parseRateCreate), never in place. */
export function parseManagerPatch(body: unknown): Parsed<ManagerPatch> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  if ("shareBps" in body) {
    return { ok: false, fields: { shareBps: "Change the share by adding a dated rate. Past share is never re-rated." } };
  }
  const fields: FieldErrors = {};
  const name = "name" in body ? parseName(body.name, fields) : undefined;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (name === undefined) return { ok: false, fields: { body: "Nothing to update." } };
  return { ok: true, value: { name } };
}

export function parseRateCreate(body: unknown): Parsed<RateWrite> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  const fields: FieldErrors = {};
  const shareBps = parseShareBps(body.shareBps, fields);
  const effectiveFrom = parseEffectiveFrom(body.effectiveFrom, fields);
  if (Object.keys(fields).length > 0 || shareBps === undefined || effectiveFrom === undefined) {
    return { ok: false, fields };
  }
  return { ok: true, value: { shareBps, effectiveFrom } };
}

/** Rates are append-only: a new one must be dated after the latest. Blocks backdating and duplicates. */
export function rateWriteError(rates: { effective_from: string }[], write: RateWrite): FieldErrors | null {
  const latest = rates.map((rate) => rate.effective_from).sort().pop();
  if (latest && write.effectiveFrom <= latest) {
    return {
      effectiveFrom:
        write.effectiveFrom === latest
          ? `A rate already starts on ${latest}.`
          : `Use a date after ${latest}, the latest rate. Past share is never re-rated.`,
    };
  }
  return null;
}

/**
 * Correcting the FIRST rate's start date: { effectiveFrom } only. This fixes when a manager
 * actually started (for example added late, took over earlier). It is not a share change:
 * the share stays the same, later rates stay forward only, and only the first rate can move.
 */
export function parseFirstRateMove(body: unknown): Parsed<{ effectiveFrom: string }> {
  if (!isRecord(body)) return { ok: false, fields: { body: "Send a JSON object." } };
  if ("shareBps" in body) {
    return { ok: false, fields: { shareBps: "Only the start date can be corrected. Change the share with a new dated rate." } };
  }
  const fields: FieldErrors = {};
  const effectiveFrom = parseEffectiveFrom(body.effectiveFrom, fields);
  if (effectiveFrom === undefined) return { ok: false, fields };
  return { ok: true, value: { effectiveFrom } };
}

export type FirstRateMoveCheck =
  | { ok: true; from: string; nextFrom: string | null }
  | { ok: false; status: 404 }
  | { ok: false; status: 400; fields: FieldErrors };

/**
 * Pure. The rate must be the manager's first (earliest) rate. The new date must stay before
 * the next rate, and no car assignment may start before it, so every day a manager has a car
 * still has a share rate in effect. Moving earlier never orphans an assignment.
 */
export function firstRateMoveError(
  rates: { id: number; effective_from: string }[],
  assignments: { car_id: number; start_date: string; car_year?: number; car_make?: string; car_model?: string; car_license_plate?: string }[],
  rateId: number,
  effectiveFrom: string
): FirstRateMoveCheck {
  const sorted = [...rates].sort((a, b) =>
    a.effective_from === b.effective_from ? Number(a.id) - Number(b.id) : a.effective_from < b.effective_from ? -1 : 1
  );
  const index = sorted.findIndex((rate) => Number(rate.id) === rateId);
  if (index < 0) return { ok: false, status: 404 };
  if (index !== 0) {
    return {
      ok: false,
      status: 400,
      fields: {
        effectiveFrom: "Only the first share rate's start date can be corrected. Later share changes apply forward only.",
      },
    };
  }
  const from = sorted[0].effective_from;
  const nextFrom = sorted[1]?.effective_from ?? null;
  if (effectiveFrom === from) return { ok: false, status: 400, fields: { effectiveFrom: `The first rate already starts on ${from}.` } };
  if (nextFrom && effectiveFrom >= nextFrom) {
    return { ok: false, status: 400, fields: { effectiveFrom: `Use a date before ${nextFrom}, when the next rate starts.` } };
  }
  const blocking = assignments
    .filter((row) => row.start_date < effectiveFrom)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
  if (blocking.length > 0) {
    const first = blocking[0];
    const car =
      first.car_make !== undefined
        ? `${first.car_year} ${first.car_make} ${first.car_model ?? ""}`.trim() +
          (first.car_license_plate ? ` (${first.car_license_plate})` : "")
        : `Car ${first.car_id}`;
    const more = blocking.length > 1 ? ` and ${blocking.length - 1} more` : "";
    const verb = blocking.length > 1 ? "are" : "is";
    return {
      ok: false,
      status: 400,
      fields: {
        effectiveFrom: `${car}${more} ${verb} assigned to this manager, starting ${first.start_date}. Use ${first.start_date} or earlier, or change ${blocking.length > 1 ? "those assignments" : "that assignment"} first.`,
      },
    };
  }
  return { ok: true, from, nextFrom };
}

/** The rate in effect on a date: the latest rate whose effective_from is on or before it. */
export function rateOn(rates: { share_bps: number; effective_from: string }[], date: string): number | null {
  let found: { share_bps: number; effective_from: string } | null = null;
  for (const rate of rates) {
    if (rate.effective_from <= date && (!found || rate.effective_from > found.effective_from)) found = rate;
  }
  return found ? Number(found.share_bps) : null;
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
  shareBps: number;
  shareCents: number;
};

export type AccrualMonth = { month: string; tripCount: number; feeCents: number; shareCents: number };
export type AccrualCar = { carId: number; tripCount: number; feeCents: number; shareCents: number };

export type ManagerAccrual = {
  tripCount: number;
  feeCents: number;
  accruedCents: number;
  months: AccrualMonth[];
  cars: AccrualCar[];
  trips: AccrualTrip[];
};

/**
 * Pure. Trips per car come in with the statement input shape. Only trips that count as
 * income earn a fee, so only those earn a share. Each trip uses the rate in effect on its
 * start date. A trip before the first rate (cannot happen through the API) earns nothing.
 */
export function buildManagerAccrual(input: {
  rates: { share_bps: number; effective_from: string }[];
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
      const shareBps = rateOn(input.rates, trip.startDate) ?? 0;
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
        shareBps,
        shareCents: managerShareCents(fee.feeCents, shareBps),
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

const MANAGER_COLUMNS = "id, name, account_id, created_at, updated_at";
const MANAGER_WITH_ACCOUNT = `SELECT m.id, m.name, m.account_id, m.created_at, m.updated_at, o.email AS account_email
  FROM managers m LEFT JOIN owners o ON o.id = m.account_id`;
const RATE_COLUMNS = "id, manager_id, share_bps, effective_from, created_at";

/**
 * Runs the statements as one D1 batch: a single transaction, all or nothing. Multi-row
 * manager writes never fall back to separate steps, so a failed insert can't leave a car
 * without its manager or a manager without its first rate.
 */
async function runAll(db: PortalD1, statements: ReturnType<PortalD1["prepare"]>[]): Promise<unknown[]> {
  if (typeof db.batch !== "function") throw new Error("d1_batch_required");
  return db.batch(statements);
}

function changesOf(result: unknown): number {
  const meta = (result as { meta?: { changes?: unknown } } | null)?.meta;
  return Number(meta?.changes ?? 0);
}

/** True for the D1/SQLite error when migration 0009 (managers.account_id) is not applied. */
export function isMissingAccountColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:?\s*(\w+\.)?account_id/i.test(message);
}

const ASSIGNMENT_SELECT = `SELECT a.id, a.car_id, a.manager_id, a.start_date, a.end_date, a.created_at,
       m.name AS manager_name, c.year AS car_year, c.make AS car_make, c.model AS car_model,
       c.license_plate AS car_license_plate
  FROM car_manager_assignments a
  JOIN managers m ON m.id = a.manager_id
  JOIN cars c ON c.id = a.car_id`;

/** Admin list: includes the linked account's email (admin-only JSON). */
export async function listManagers(db: PortalD1): Promise<ManagerRow[]> {
  const result = await db.prepare(`${MANAGER_WITH_ACCOUNT} ORDER BY m.name, m.id`).all<ManagerRow>();
  return result.results;
}

export async function getManager(db: PortalD1, id: number): Promise<ManagerRow | null> {
  return db.prepare(`${MANAGER_WITH_ACCOUNT} WHERE m.id = ?`).bind(id).first<ManagerRow>();
}

/** The manager role: the managers row whose account_id is this signed-in account, if any. */
export async function getManagerByAccount(db: PortalD1, accountId: number): Promise<ManagerRow | null> {
  return db
    .prepare(`SELECT ${MANAGER_COLUMNS} FROM managers WHERE account_id = ?`)
    .bind(accountId)
    .first<ManagerRow>();
}

/**
 * Same lookup for the sign-in paths (login, session, manager view). If 0009 is missing, failed,
 * or rolled back, the column does not exist: that means no manager role, never a broken session.
 * Any other error still throws.
 */
export async function findManagerRole(db: PortalD1, accountId: number): Promise<ManagerRow | null> {
  try {
    return await getManagerByAccount(db, accountId);
  } catch (error) {
    if (isMissingAccountColumn(error)) return null;
    throw error;
  }
}

/**
 * New login account + manager + first rate, as one D1 batch. The caller has already refused an
 * email that belongs to an existing account; if one appears in between, the owners UNIQUE index
 * fails the batch and nothing is written. The new account is never an admin.
 */
export async function insertManager(db: PortalD1, write: ManagerWrite, actorId: number): Promise<number> {
  await runAll(
    db,
    [
      db.prepare(`INSERT INTO owners (name, email, is_admin) VALUES (?, ?, 0)`).bind(write.name, write.email),
      db
        .prepare(
          `INSERT INTO managers (name, account_id, created_by) SELECT ?, id, ? FROM owners WHERE email = ?`
        )
        .bind(write.name, actorId, write.email),
      db
        .prepare(
          `INSERT INTO manager_share_rates (manager_id, share_bps, effective_from, created_by)
           SELECT id, ?, ?, ? FROM managers WHERE name = ?`
        )
        .bind(write.shareBps, write.effectiveFrom, actorId, write.name),
    ]
  );
  const row = await db.prepare(`SELECT id FROM managers WHERE name = ?`).bind(write.name).first<{ id: number }>();
  if (!row) throw new Error("manager_insert_failed");
  return Number(row.id);
}

/**
 * Manager row linked to an existing account + first rate, as one D1 batch. No new login and no
 * admin change. The account_id unique index fails the batch if the account already manages.
 */
export async function insertManagerForAccount(
  db: PortalD1,
  write: ManagerFromAccountWrite,
  actorId: number
): Promise<number> {
  await runAll(db, [
    db
      .prepare(`INSERT INTO managers (name, account_id, created_by) VALUES (?, ?, ?)`)
      .bind(write.name, write.ownerId, actorId),
    db
      .prepare(
        `INSERT INTO manager_share_rates (manager_id, share_bps, effective_from, created_by)
         SELECT id, ?, ?, ? FROM managers WHERE account_id = ?`
      )
      .bind(write.shareBps, write.effectiveFrom, actorId, write.ownerId),
  ]);
  const row = await db.prepare(`SELECT id FROM managers WHERE account_id = ?`).bind(write.ownerId).first<{ id: number }>();
  if (!row) throw new Error("manager_insert_failed");
  return Number(row.id);
}

/**
 * New login account for an unlinked manager, and the link, as one D1 batch. Never an admin.
 * The owners INSERT only runs while this manager is still unlinked, inside the same transaction
 * as the UPDATE, so a race cannot leave an orphan owners row. Returns false (nothing written)
 * when the manager was linked in the meantime.
 */
export async function createAccountForManager(
  db: PortalD1,
  managerId: number,
  name: string,
  email: string
): Promise<boolean> {
  const results = await runAll(db, [
    db
      .prepare(
        `INSERT INTO owners (name, email, is_admin)
         SELECT ?, ?, 0 WHERE EXISTS (SELECT 1 FROM managers WHERE id = ? AND account_id IS NULL)`
      )
      .bind(name, email, managerId),
    db
      .prepare(
        `UPDATE managers SET account_id = (SELECT id FROM owners WHERE email = ?),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND account_id IS NULL`
      )
      .bind(email, managerId),
  ]);
  const inserted = changesOf(results[0]);
  const linked = changesOf(results[1]);
  if (inserted === 1 && linked === 1) return true;
  if (inserted === 1) {
    // Defensive: should not happen inside one transaction. Remove the unlinked new account.
    await db
      .prepare(
        `DELETE FROM owners WHERE email = ? AND password_hash IS NULL
           AND NOT EXISTS (SELECT 1 FROM managers WHERE account_id = owners.id)
           AND NOT EXISTS (SELECT 1 FROM cars WHERE owner_id = owners.id)`
      )
      .bind(email)
      .run();
  }
  return false;
}

/**
 * Explicit link to an existing account the admin confirmed by id. Only an unlinked row changes.
 * Does not touch owners (is_admin is never granted or revoked here). Returns rows changed.
 */
export async function linkManagerAccount(db: PortalD1, managerId: number, ownerId: number): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE managers SET account_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND account_id IS NULL`
    )
    .bind(ownerId, managerId)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function updateManagerName(db: PortalD1, id: number, name: string): Promise<void> {
  await db
    .prepare(`UPDATE managers SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .bind(name, id)
    .run();
}

export async function listRates(db: PortalD1, managerId: number): Promise<RateRow[]> {
  const result = await db
    .prepare(`SELECT ${RATE_COLUMNS} FROM manager_share_rates WHERE manager_id = ? ORDER BY effective_from, id`)
    .bind(managerId)
    .all<RateRow>();
  return result.results;
}

export async function listAllRates(db: PortalD1): Promise<RateRow[]> {
  const result = await db
    .prepare(`SELECT ${RATE_COLUMNS} FROM manager_share_rates ORDER BY manager_id, effective_from, id`)
    .all<RateRow>();
  return result.results;
}

export async function insertRate(db: PortalD1, managerId: number, write: RateWrite, actorId: number): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO manager_share_rates (manager_id, share_bps, effective_from, created_by) VALUES (?, ?, ?, ?)`
    )
    .bind(managerId, write.shareBps, write.effectiveFrom, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

/**
 * Moves the first rate's effective_from, guarded in SQL so a race can't break the rules checked
 * in firstRateMoveError: the row must still have its old date, no other rate may start on or
 * before the new date, and no assignment of this manager may start before it. Returns changes (1 or 0).
 */
export async function moveFirstRate(
  db: PortalD1,
  managerId: number,
  rateId: number,
  from: string,
  to: string
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE manager_share_rates SET effective_from = ?
        WHERE id = ? AND manager_id = ? AND effective_from = ?
          AND NOT EXISTS (
            SELECT 1 FROM manager_share_rates r WHERE r.manager_id = ? AND r.id <> ? AND r.effective_from <= ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM car_manager_assignments a WHERE a.manager_id = ? AND a.start_date < ?
          )`
    )
    .bind(to, rateId, managerId, from, managerId, rateId, to, managerId, to)
    .run();
  return Number(result.meta.changes ?? 0);
}

/** Close the open assignment and open the next one together (reassign). */
export async function reassign(
  db: PortalD1,
  close: { id: number; endDate: string },
  open: { carId: number; managerId: number; startDate: string },
  actorId: number
): Promise<void> {
  await runAll(
    db,
    [
      db
        .prepare(`UPDATE car_manager_assignments SET end_date = ? WHERE id = ? AND end_date IS NULL`)
        .bind(close.endDate, close.id),
      db
        .prepare(
          `INSERT INTO car_manager_assignments (car_id, manager_id, start_date, created_by) VALUES (?, ?, ?, ?)`
        )
        .bind(open.carId, open.managerId, open.startDate, actorId),
    ]
  );
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

/** Undo a reassignment: drop the newest row and reopen the one it replaced, together. */
export async function undoReassign(db: PortalD1, carId: number, deleteId: number, reopenId: number): Promise<void> {
  // Delete first so the open-assignment unique index never sees two open rows.
  await runAll(
    db,
    [
      db.prepare(`DELETE FROM car_manager_assignments WHERE id = ? AND car_id = ?`).bind(deleteId, carId),
      db.prepare(`UPDATE car_manager_assignments SET end_date = NULL WHERE id = ? AND car_id = ?`).bind(reopenId, carId),
    ]
  );
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

export async function managerAccrual(db: PortalD1, rates: RateRow[], assignments: AssignmentRow[]) {
  const tripsByCar = await tripsForCars(
    db,
    assignments.map((row) => Number(row.car_id))
  );
  return buildManagerAccrual({ rates, assignments, tripsByCar });
}

// ---------- json ----------

export function rateJson(row: RateRow) {
  return {
    id: Number(row.id),
    shareBps: Number(row.share_bps),
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

/** shareBps is the rate in effect today; nextRate is a future-dated rate, if one is set. */
export function managerJson(row: ManagerRow, rates: RateRow[], today: string) {
  const sorted = [...rates].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const next = sorted.find((rate) => rate.effective_from > today) ?? null;
  return {
    id: Number(row.id),
    name: row.name,
    accountId: row.account_id == null ? null : Number(row.account_id),
    accountEmail: row.account_email ? row.account_email.trim().toLowerCase() : null,
    shareBps: rateOn(sorted, today),
    firstEffectiveFrom: sorted[0]?.effective_from ?? null,
    nextRate: next ? rateJson(next) : null,
    rates: sorted.map(rateJson),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RateJson = ReturnType<typeof rateJson>;

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
