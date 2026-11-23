import type { CarRow } from "./db";
import type { PortalD1 } from "./d1";
import {
  buildStatements,
  FEE_TIERS,
  statementForMonth,
  totalPayoutDueCents,
  type MonthStatement,
  type StatementExpenseInput,
  type StatementPayoutInput,
  type StatementTripInput,
} from "./statement";
import type { PayoutWrite } from "./validate";

export type PayoutRow = {
  id: number;
  car_id: number;
  period_month: string;
  paid_date: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
  created_by: number;
};

type StatementTripRow = {
  id: number;
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

type StatementExpenseRow = {
  id: number;
  entry_date: string;
  category: string;
  amount_cents: number;
  note: string | null;
};

const PAYOUT_COLUMNS = "id, car_id, period_month, paid_date, amount_cents, note, created_at, created_by";

export async function insertPayout(
  db: PortalD1,
  carId: number,
  payout: PayoutWrite,
  actorId: number
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO payouts (car_id, period_month, paid_date, amount_cents, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(carId, payout.periodMonth, payout.paidDate, payout.amountCents, payout.note, actorId)
    .run();
  return Number(result.meta.last_row_id);
}

export async function getPayout(db: PortalD1, carId: number, id: number): Promise<PayoutRow | null> {
  return db
    .prepare(`SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE id = ? AND car_id = ?`)
    .bind(id, carId)
    .first<PayoutRow>();
}

export async function listPayouts(db: PortalD1, carId: number): Promise<PayoutRow[]> {
  const result = await db
    .prepare(`SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE car_id = ? ORDER BY period_month, paid_date, id`)
    .bind(carId)
    .all<PayoutRow>();
  return result.results;
}

export async function deletePayout(db: PortalD1, carId: number, id: number): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM payouts WHERE id = ? AND car_id = ?`)
    .bind(id, carId)
    .run();
  return result.meta.changes > 0;
}

export function payoutJson(row: PayoutRow): StatementPayoutInput & { carId: number; createdAt: string } {
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    periodMonth: row.period_month,
    paidDate: row.paid_date,
    amountCents: Number(row.amount_cents),
    note: row.note,
    createdAt: row.created_at,
  };
}

async function statementInputs(db: PortalD1, carId: number) {
  const [trips, expenses, payouts] = await Promise.all([
    db
      .prepare(
        `SELECT id, platform, external_trip_id, start_date, end_date, status, counts_as_income,
                payout_cents, tax_cents, pending_payout_cents, has_pending
         FROM trips WHERE car_id = ? ORDER BY start_date, id`
      )
      .bind(carId)
      .all<StatementTripRow>(),
    db
      .prepare(
        `SELECT id, entry_date, category, amount_cents, note
         FROM expenses WHERE car_id = ? ORDER BY entry_date, id`
      )
      .bind(carId)
      .all<StatementExpenseRow>(),
    listPayouts(db, carId),
  ]);
  const tripInputs: StatementTripInput[] = trips.results.map((row) => ({
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
  }));
  const expenseInputs: StatementExpenseInput[] = expenses.results.map((row) => ({
    id: Number(row.id),
    entryDate: row.entry_date,
    category: row.category,
    amountCents: Number(row.amount_cents),
    note: row.note,
  }));
  const payoutInputs: StatementPayoutInput[] = payouts.map((row) => ({
    id: Number(row.id),
    periodMonth: row.period_month,
    paidDate: row.paid_date,
    amountCents: Number(row.amount_cents),
    note: row.note,
  }));
  return { trips: tripInputs, expenses: expenseInputs, payouts: payoutInputs };
}

function historyRow(statement: MonthStatement) {
  return {
    month: statement.month,
    carryInCents: statement.carryInCents,
    incomeCents: statement.incomeCents,
    expenseCents: statement.expenseCents,
    managementFeeCents: statement.managementFeeCents,
    closingBalanceCents: statement.closingBalanceCents,
    paidCents: statement.paidCents,
    payoutDueCents: statement.payoutDueCents,
    carryOutCents: statement.carryOutCents,
    overpaidCents: statement.overpaidCents,
    open: statement.open,
  };
}

/** One car only. Callers check admin access or owner_id before calling. */
export async function carStatement(db: PortalD1, car: CarRow, month: string, currentMonth: string) {
  const inputs = await statementInputs(db, Number(car.id));
  const lastMonth = month > currentMonth ? month : currentMonth;
  const statements = buildStatements({ ...inputs, lastMonth, currentMonth });
  const statement = statementForMonth(statements, month, currentMonth);
  return {
    car: {
      id: Number(car.id),
      year: Number(car.year),
      make: car.make,
      model: car.model,
      licensePlate: car.license_plate,
    },
    month,
    currentMonth,
    feeTiers: FEE_TIERS.map((tier) => ({
      label: tier.label,
      minDays: tier.minDays,
      maxDays: Number.isFinite(tier.maxDays) ? tier.maxDays : null,
      bps: tier.bps,
    })),
    rules: {
      attribution: "A trip counts entirely in the month it starts. Expenses count in the month they are dated.",
      fee: "The management fee is figured per trip on its counted income, before expenses, and is booked as the last expense of the month.",
      carry: "A month that ends below zero carries the shortfall into next month. A payout is due only when the balance is above zero.",
    },
    statement,
    history: statements.map(historyRow),
    totalPayoutDueCents: totalPayoutDueCents(statements),
  };
}
