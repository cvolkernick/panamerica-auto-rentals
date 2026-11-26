/**
 * Ledger start date: the first day that counts toward a car's money.
 *
 * Panamerica started running cars through the portal in November 2026
 * (Chris, 2026-11-26). Trips, expenses, and payouts dated before a car's
 * ledger start stay in the database, untouched, but every money and report
 * path ignores them: balances, opening balances, statements, month, to-date
 * and all-time totals, the owner view, and the manager view. November 2026
 * therefore opens at zero for every car.
 *
 * Re-importing a trip dated before the start updates its stored row (the
 * import is idempotent) but cannot change any balance, because the report
 * queries never read it.
 *
 * Per car: cars.ledger_start_date (migration 0011) is nullable. NULL means
 * the default below, applied here in code, so every car starts on 2026-11-01
 * without rewriting any row. The column is read defensively: before 0011 is
 * applied, every car gets the default, so deploy order does not matter.
 */
import type { PortalD1 } from "./d1";

export const DEFAULT_LEDGER_START_DATE = "2026-11-01";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD. Rows dated on this day count; rows before it do not. */
export function ledgerStartDate(stored?: string | null): string {
  return stored && ISO_DATE.test(stored) ? stored : DEFAULT_LEDGER_START_DATE;
}

export function isMissingLedgerStartColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:?\s*(\w+\.)?ledger_start_date/i.test(message);
}

/** The car's ledger start, or the default when unset or before migration 0011. */
export async function carLedgerStart(db: PortalD1, carId: number): Promise<string> {
  try {
    const row = await db
      .prepare(`SELECT ledger_start_date FROM cars WHERE id = ?`)
      .bind(carId)
      .first<{ ledger_start_date: string | null }>();
    return ledgerStartDate(row?.ledger_start_date ?? null);
  } catch (error) {
    if (isMissingLedgerStartColumn(error)) return DEFAULT_LEDGER_START_DATE;
    throw error;
  }
}

/**
 * Clamp an inclusive-start / exclusive-end date range so nothing before the
 * ledger start is read. A range that ends on or before the start comes back
 * empty (start === end), which every query treats as no rows.
 */
export function clampToLedgerStart(
  bounds: { start: string; end: string },
  ledgerStart: string
): { start: string; end: string } {
  const start = bounds.start > ledgerStart ? bounds.start : ledgerStart;
  return { start, end: start > bounds.end ? start : bounds.end };
}

/** Error text for a write dated before the car's ledger start. */
export function beforeLedgerStartMessage(ledgerStart: string): string {
  return `This date is before this car's ledger start (${ledgerStart}).`;
}

/**
 * Expense and payout writes dated before the car's ledger start would be saved
 * but never count, so they are rejected. Returns validation fields, or null.
 */
export async function ledgerStartGuard(
  db: PortalD1,
  carId: number,
  dates: { entryDate?: string; periodMonth?: string; paidDate?: string }
): Promise<Record<string, string> | null> {
  const ledgerStart = await carLedgerStart(db, carId);
  const fields: Record<string, string> = {};
  if (dates.entryDate !== undefined && dates.entryDate < ledgerStart) {
    fields.entryDate = beforeLedgerStartMessage(ledgerStart);
  }
  if (dates.periodMonth !== undefined && dates.periodMonth < ledgerStart.slice(0, 7)) {
    fields.periodMonth = beforeLedgerStartMessage(ledgerStart);
  }
  if (dates.paidDate !== undefined && dates.paidDate < ledgerStart) {
    fields.paidDate = beforeLedgerStartMessage(ledgerStart);
  }
  return Object.keys(fields).length > 0 ? fields : null;
}
