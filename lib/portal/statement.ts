/**
 * Management fee, per-car running balance, and monthly statements.
 *
 * Pure functions only. Integer cents everywhere. See docs/portal-statement-spec.md.
 *
 * Rules (Chris, 2026-11-23):
 * - Each car is self-contained. Nothing is pooled across an owner's cars.
 * - The management fee is figured on rental revenue only, before expenses, and is
 *   booked as the last expense of the month.
 * - Expenses that rental income has not covered carry forward and come out of later
 *   rental income. A payout is due only when the running balance is above zero.
 */

/** Trip-length tiers of the one flagship plan, in basis points. */
export const FEE_TIERS = [
  { label: "Under 7 days", minDays: 0, maxDays: 6, bps: 2000 },
  { label: "7 to 21 days", minDays: 7, maxDays: 21, bps: 1500 },
  { label: "Over 21 days", minDays: 22, maxDays: Number.POSITIVE_INFINITY, bps: 1000 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDateUtc(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

/**
 * Trip length in whole days: calendar days from start_date to end_date.
 * A same-day trip, or a trip with no usable end date, counts as 1 day.
 */
export function tripLengthDays(startDate: string, endDate: string | null): number {
  const start = isoDateUtc(startDate);
  const end = endDate ? isoDateUtc(endDate) : null;
  if (start === null || end === null) return 1;
  const days = Math.round((end - start) / DAY_MS);
  return days < 1 ? 1 : days;
}

/** Fee rate in basis points. Exactly 7 and exactly 21 days are both in the 15% tier. */
export function feeRateBps(days: number): number {
  if (days < 7) return 2000;
  if (days <= 21) return 1500;
  return 1000;
}

/**
 * Fee on one trip, in integer cents, rounded half up (0.5 cent rounds up).
 * A base of zero or less earns no fee.
 */
export function managementFeeCents(baseCents: number, bps: number): number {
  if (!Number.isSafeInteger(baseCents) || !Number.isSafeInteger(bps)) throw new Error("integer cents only");
  if (baseCents <= 0 || bps <= 0) return 0;
  return Math.floor((baseCents * bps + 5000) / 10000);
}

export type StatementTripInput = {
  id: number;
  platform: string;
  externalTripId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  countsAsIncome: boolean;
  /** Counted income: payout minus pass-through tax. */
  incomeCents: number;
  hasPending: boolean;
  pendingPayoutCents: number | null;
};

export type StatementExpenseInput = {
  id: number;
  entryDate: string;
  category: string;
  amountCents: number;
  note: string | null;
};

export type StatementPayoutInput = {
  id: number;
  periodMonth: string;
  paidDate: string;
  amountCents: number;
  note: string | null;
};

export type StatementTrip = StatementTripInput & {
  days: number;
  feeRateBps: number;
  feeCents: number;
};

export type MonthStatement = {
  month: string;
  /** Shortfall carried in from earlier months. Zero or negative. */
  carryInCents: number;
  incomeCents: number;
  expenseCents: number;
  managementFeeCents: number;
  /** carryIn + income - expenses - fee. */
  closingBalanceCents: number;
  /** Payouts recorded against this month. */
  paidCents: number;
  /** Still owed to the owner for this month. Zero or positive. */
  payoutDueCents: number;
  /** Shortfall that rolls into next month. Zero or negative. */
  carryOutCents: number;
  /** Payouts recorded are more than this month's closing balance now supports. */
  overpaidCents: number;
  /** The month has not ended yet in America/New_York. */
  open: boolean;
  trips: StatementTrip[];
  expenses: StatementExpenseInput[];
  payouts: StatementPayoutInput[];
};

export function feeForTrip(trip: StatementTripInput): StatementTrip {
  const days = tripLengthDays(trip.startDate, trip.endDate);
  const bps = feeRateBps(days);
  const feeCents = trip.countsAsIncome ? managementFeeCents(trip.incomeCents, bps) : 0;
  return { ...trip, days, feeRateBps: bps, feeCents };
}

export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Builds one statement per month, oldest first, from the car's first activity month
 * through max(lastMonth, latest activity month).
 *
 * carryIn(m) = carryOut(m - 1); the first month starts at 0.
 * closing(m) = carryIn(m) + income(m) - expenses(m) - fee(m)
 * left(m)    = closing(m) - paid(m)
 * payoutDue(m) = max(0, left(m))
 * carryOut(m)  = min(0, left(m))
 *
 * A positive balance never rolls forward: it is owed for its own month until paid.
 * Paying more than the closing balance (for example after a re-import lowers income)
 * leaves a negative left(m), which carries forward and is recovered from later income.
 */
export function buildStatements(input: {
  trips: StatementTripInput[];
  expenses: StatementExpenseInput[];
  payouts: StatementPayoutInput[];
  lastMonth: string;
  currentMonth: string;
}): MonthStatement[] {
  const months = new Set<string>();
  for (const trip of input.trips) months.add(monthOf(trip.startDate));
  for (const expense of input.expenses) months.add(monthOf(expense.entryDate));
  for (const payout of input.payouts) months.add(payout.periodMonth);
  if (months.size === 0) return [];
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = [sorted[sorted.length - 1], input.lastMonth].sort()[1];

  const statements: MonthStatement[] = [];
  let carry = 0;
  for (let month = first; month <= last; month = nextMonth(month)) {
    const trips = input.trips
      .filter((trip) => monthOf(trip.startDate) === month)
      .map(feeForTrip);
    const expenses = input.expenses.filter((expense) => monthOf(expense.entryDate) === month);
    const payouts = input.payouts.filter((payout) => payout.periodMonth === month);
    const incomeCents = trips.reduce((sum, trip) => sum + (trip.countsAsIncome ? trip.incomeCents : 0), 0);
    const feeCents = trips.reduce((sum, trip) => sum + trip.feeCents, 0);
    const expenseCents = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
    const paidCents = payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
    const closing = carry + incomeCents - expenseCents - feeCents;
    const left = closing - paidCents;
    const statement: MonthStatement = {
      month,
      carryInCents: carry,
      incomeCents,
      expenseCents,
      managementFeeCents: feeCents,
      closingBalanceCents: closing,
      paidCents,
      payoutDueCents: Math.max(0, left),
      carryOutCents: Math.min(0, left),
      overpaidCents: paidCents > Math.max(0, closing) ? paidCents - Math.max(0, closing) : 0,
      open: month >= input.currentMonth,
      trips,
      expenses,
      payouts,
    };
    statements.push(statement);
    carry = statement.carryOutCents;
  }
  return statements;
}

export function emptyStatement(month: string, currentMonth: string, carryInCents = 0): MonthStatement {
  return {
    month,
    carryInCents,
    incomeCents: 0,
    expenseCents: 0,
    managementFeeCents: 0,
    closingBalanceCents: carryInCents,
    paidCents: 0,
    payoutDueCents: 0,
    carryOutCents: Math.min(0, carryInCents),
    overpaidCents: 0,
    open: month >= currentMonth,
    trips: [],
    expenses: [],
    payouts: [],
  };
}

/** Statement for one month, with a zero statement before the car's first activity. */
export function statementForMonth(
  statements: MonthStatement[],
  month: string,
  currentMonth: string
): MonthStatement {
  const found = statements.find((statement) => statement.month === month);
  if (found) return found;
  return emptyStatement(month, currentMonth);
}

/** Payout owed across every month so far, net of recorded payouts. */
export function totalPayoutDueCents(statements: MonthStatement[]): number {
  return statements.reduce((sum, statement) => sum + statement.payoutDueCents, 0);
}
