/**
 * Manager view, phase 2 (docs/manager-role.md). Read-only: every route here is GET.
 * The only phase 2 writes are auth (login, logout, session, CSRF, invite password), which
 * live in login.ts and invite.ts.
 *
 * The caller has authenticated the session. The manager role is the managers row whose
 * account_id is this account. Every car read is limited to this manager's own
 * car_manager_assignments windows (start inclusive, end exclusive). Manager JSON never
 * carries owner name, owner email, payouts, or guest data; a car carries ownerId only.
 *
 *   GET /api/portal/manager                          share, rates, assignments, accrued share
 *   GET /api/portal/manager/cars                     cars this manager has or had, with windows
 *   GET /api/portal/manager/cars/:id                 one car with its windows (404 if never assigned)
 *   GET /api/portal/manager/cars/:id/statement?month trips, earnings, expenses inside the windows
 *   GET /api/portal/manager/cars/:id/ledger?month    car ledger rows inside the windows (no payouts)
 */
import type { PortalD1 } from "./d1";
import { forbidden, json, validationError } from "./http";
import { currentMonthEastern, monthBounds, todayEastern } from "./ledger";
import {
  assignmentCovers,
  getManagerByAccount,
  listRates,
  managerShareCents,
  rateJson,
  rateOn,
  tripsForCars,
  buildManagerAccrual,
  type ManagerRow,
  type RateRow,
} from "./managers";
import { feeForTrip, nextMonth } from "./statement";
import { parseLedgerMonth } from "./validate";

export const MANAGER_API_PREFIX = "/api/portal/manager";

export type Window = { startDate: string; endDate: string | null };

type AssignmentRow = {
  id: number;
  car_id: number;
  start_date: string;
  end_date: string | null;
};

/** Car columns a manager may see. No owner join: no owner name or email can leak. */
type ManagerCarRow = {
  id: number;
  owner_id: number;
  year: number;
  make: string;
  model: string;
  color: string;
  license_plate: string;
  vin: string;
};

export function isManagerPath(path: string): boolean {
  return path === MANAGER_API_PREFIX || path.startsWith(`${MANAGER_API_PREFIX}/`);
}

/** True when the date falls in any window [start, end). */
export function inWindows(windows: Window[], date: string): boolean {
  return windows.some((w) => assignmentCovers({ start_date: w.startDate, end_date: w.endDate }, date));
}

/** Windows cut to [start, end) of one month. Windows that miss the month drop out. */
export function clipWindows(windows: Window[], bounds: { start: string; end: string }): Window[] {
  const out: Window[] = [];
  for (const w of windows) {
    const start = w.startDate > bounds.start ? w.startDate : bounds.start;
    const endRaw = w.endDate ?? bounds.end;
    const end = endRaw < bounds.end ? endRaw : bounds.end;
    if (start < end) out.push({ startDate: start, endDate: end });
  }
  return out;
}

/** Months (YYYY-MM) a manager may open for a car, oldest first, capped at the current month. */
export function windowMonths(windows: Window[], currentMonth: string): string[] {
  const months = new Set<string>();
  for (const w of windows) {
    let month = w.startDate.slice(0, 7);
    // Exclusive end: the last covered day is the day before end_date.
    const lastDay = w.endDate ? previousDay(w.endDate) : null;
    const last = lastDay ? lastDay.slice(0, 7) : currentMonth;
    const stop = last < currentMonth ? last : currentMonth;
    while (month <= stop) {
      months.add(month);
      month = nextMonth(month);
    }
  }
  return [...months].sort();
}

function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function readOnly(): Response {
  return json({ error: "method_not_allowed", reason: "manager_view_read_only" }, 405, { allow: "GET" });
}

function parsePathId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

async function myAssignments(db: PortalD1, managerId: number): Promise<AssignmentRow[]> {
  const result = await db
    .prepare(
      `SELECT id, car_id, start_date, end_date FROM car_manager_assignments
        WHERE manager_id = ? ORDER BY start_date, id`
    )
    .bind(managerId)
    .all<AssignmentRow>();
  return result.results;
}

function windowsByCar(assignments: AssignmentRow[]): Map<number, Window[]> {
  const map = new Map<number, Window[]>();
  for (const row of assignments) {
    const carId = Number(row.car_id);
    const list = map.get(carId) ?? [];
    list.push({ startDate: row.start_date, endDate: row.end_date });
    map.set(carId, list);
  }
  return map;
}

async function managerCar(db: PortalD1, carId: number): Promise<ManagerCarRow | null> {
  return db
    .prepare(
      `SELECT id, owner_id, year, make, model, color, license_plate, vin FROM cars WHERE id = ?`
    )
    .bind(carId)
    .first<ManagerCarRow>();
}

export function managerCarJson(row: ManagerCarRow, windows: Window[]) {
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    year: Number(row.year),
    make: row.make,
    model: row.model,
    color: row.color,
    licensePlate: row.license_plate,
    vin: row.vin,
    windows,
    current: windows.some((w) => w.endDate === null),
    months: windowMonths(windows, currentMonthEastern()),
  };
}

function managerSelfJson(row: ManagerRow, rates: RateRow[], today: string) {
  const sorted = [...rates].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  return {
    id: Number(row.id),
    name: row.name,
    shareBps: rateOn(sorted, today),
    rates: sorted.map(rateJson),
  };
}

type TripRow = {
  id: number;
  platform: string;
  start_date: string;
  end_date: string | null;
  status: string;
  counts_as_income: number;
  payout_cents: number;
  tax_cents: number | null;
};

type ExpenseRow = {
  id: number;
  entry_date: string;
  category: string;
  amount_cents: number;
  note: string | null;
};

type LedgerRow = {
  id: number;
  entry_date: string;
  type: string;
  amount_cents: number;
  note: string | null;
};

async function statementJson(
  db: PortalD1,
  carId: number,
  month: string,
  windows: Window[],
  rates: RateRow[]
) {
  const bounds = monthBounds(month);
  const scoped = clipWindows(windows, bounds);
  const [trips, expenses] = await Promise.all([
    db
      .prepare(
        `SELECT id, platform, start_date, end_date, status, counts_as_income, payout_cents, tax_cents
           FROM trips WHERE car_id = ? AND start_date >= ? AND start_date < ? ORDER BY start_date, id`
      )
      .bind(carId, bounds.start, bounds.end)
      .all<TripRow>(),
    db
      .prepare(
        `SELECT id, entry_date, category, amount_cents, note
           FROM expenses WHERE car_id = ? AND entry_date >= ? AND entry_date < ? ORDER BY entry_date, id`
      )
      .bind(carId, bounds.start, bounds.end)
      .all<ExpenseRow>(),
  ]);
  // A trip belongs to whoever managed the car on its start date (same rule as accrual).
  const tripRows = trips.results
    .filter((row) => inWindows(scoped, row.start_date))
    .map((row) => {
      const incomeCents = Number(row.payout_cents) - (row.tax_cents === null ? 0 : Number(row.tax_cents));
      const fee = feeForTrip({
        id: Number(row.id),
        platform: row.platform,
        externalTripId: "",
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        countsAsIncome: Number(row.counts_as_income) === 1,
        incomeCents,
        hasPending: false,
        pendingPayoutCents: null,
      });
      const shareBps = fee.feeCents > 0 ? rateOn(rates, row.start_date) ?? 0 : 0;
      return {
        id: Number(row.id),
        platform: row.platform,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        countsAsIncome: fee.countsAsIncome,
        incomeCents: fee.countsAsIncome ? incomeCents : 0,
        days: fee.days,
        feeRateBps: fee.feeRateBps,
        feeCents: fee.feeCents,
        shareBps,
        shareCents: managerShareCents(fee.feeCents, shareBps),
      };
    });
  const expenseRows = expenses.results
    .filter((row) => inWindows(scoped, row.entry_date))
    .map((row) => ({
      id: Number(row.id),
      entryDate: row.entry_date,
      category: row.category,
      amountCents: Number(row.amount_cents),
      note: row.note,
    }));
  return {
    carId,
    month,
    windows: scoped,
    trips: tripRows,
    expenses: expenseRows,
    totals: {
      tripCount: tripRows.length,
      incomeCents: tripRows.reduce((sum, t) => sum + t.incomeCents, 0),
      expenseCents: expenseRows.reduce((sum, e) => sum + e.amountCents, 0),
      feeCents: tripRows.reduce((sum, t) => sum + t.feeCents, 0),
      shareCents: tripRows.reduce((sum, t) => sum + t.shareCents, 0),
    },
  };
}

async function ledgerJson(db: PortalD1, carId: number, windows: Window[], month: string | null) {
  const bounds = month ? monthBounds(month) : null;
  const scoped = bounds ? clipWindows(windows, bounds) : windows;
  // Payout rows are owner payouts: they stay out of the manager view.
  const result = bounds
    ? await db
        .prepare(
          `SELECT id, entry_date, type, amount_cents, note FROM car_ledger
            WHERE car_id = ? AND type <> 'payout' AND entry_date >= ? AND entry_date < ?
            ORDER BY entry_date, id`
        )
        .bind(carId, bounds.start, bounds.end)
        .all<LedgerRow>()
    : await db
        .prepare(
          `SELECT id, entry_date, type, amount_cents, note FROM car_ledger
            WHERE car_id = ? AND type <> 'payout' ORDER BY entry_date, id`
        )
        .bind(carId)
        .all<LedgerRow>();
  const entries = result.results
    .filter((row) => inWindows(scoped, row.entry_date))
    .map((row) => ({
      id: Number(row.id),
      entryDate: row.entry_date,
      type: row.type,
      amountCents: Number(row.amount_cents),
      note: row.note,
    }));
  return { carId, month, windows: scoped, entries };
}

export async function routeManager(
  request: Request,
  db: PortalD1,
  path: string,
  method: string,
  accountId: number
): Promise<Response> {
  const manager = await getManagerByAccount(db, accountId);
  if (!manager) return forbidden("not_manager");
  if (method !== "GET" && method !== "HEAD") return readOnly();
  const managerId = Number(manager.id);

  if (path === MANAGER_API_PREFIX) {
    const [rates, assignments] = await Promise.all([listRates(db, managerId), myAssignments(db, managerId)]);
    const tripsByCar = await tripsForCars(db, assignments.map((row) => Number(row.car_id)));
    const accrual = buildManagerAccrual({ rates, assignments, tripsByCar });
    return json({
      manager: managerSelfJson(manager, rates, todayEastern()),
      assignments: assignments.map((row) => ({
        id: Number(row.id),
        carId: Number(row.car_id),
        startDate: row.start_date,
        endDate: row.end_date,
        current: row.end_date === null,
      })),
      accrual,
    });
  }

  if (path === `${MANAGER_API_PREFIX}/cars`) {
    const byCar = windowsByCar(await myAssignments(db, managerId));
    const cars = [];
    for (const [carId, windows] of byCar) {
      const row = await managerCar(db, carId);
      if (row) cars.push(managerCarJson(row, windows));
    }
    cars.sort((a, b) => (a.current === b.current ? a.id - b.id : a.current ? -1 : 1));
    return json({ cars });
  }

  const carMatch = path.match(/^\/api\/portal\/manager\/cars\/([1-9]\d*)(?:\/(statement|ledger))?$/);
  if (!carMatch) return notFound();
  const carId = parsePathId(carMatch[1]);
  if (carId === null) return notFound();
  const windows = windowsByCar(await myAssignments(db, managerId)).get(carId);
  // Never assigned to this manager (including another manager's car): same 404 as a missing car.
  if (!windows || windows.length === 0) return notFound();
  const car = await managerCar(db, carId);
  if (!car) return notFound();

  if (!carMatch[2]) return json({ car: managerCarJson(car, windows) });

  const month = parseLedgerMonth(new URL(request.url).searchParams.get("month"));
  if (!month.ok) return validationError(month.fields);

  if (carMatch[2] === "ledger") {
    if (month.value && clipWindows(windows, monthBounds(month.value)).length === 0) {
      return json({ error: "not_found", reason: "outside_assignment" }, 404);
    }
    return json(await ledgerJson(db, carId, windows, month.value));
  }

  const selected = month.value ?? currentMonthEastern();
  // A month with no day inside this manager's windows is not theirs to read.
  if (clipWindows(windows, monthBounds(selected)).length === 0) {
    return json({ error: "not_found", reason: "outside_assignment" }, 404);
  }
  const rates = await listRates(db, managerId);
  return json(await statementJson(db, carId, selected, windows, rates));
}
