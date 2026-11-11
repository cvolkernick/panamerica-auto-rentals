/**
 * Money direction for one ledger row.
 * trip_income is money in. Every other type is a deduction or a payout.
 * Amounts stay positive; this helper is the only place that maps type to direction.
 */
export const LEDGER_TYPES = [
  "trip_income",
  "commission",
  "maintenance",
  "cleaning",
  "tolls",
  "insurance",
  "payout",
  "other",
] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

export type LedgerDirection = "income" | "deduction";

export const LEDGER_TYPE_LABELS = {
  trip_income: "Trip income",
  commission: "Commission",
  maintenance: "Maintenance",
  cleaning: "Cleaning",
  tolls: "Tolls",
  insurance: "Insurance",
  payout: "Payout",
  other: "Other",
} as const satisfies Record<LedgerType, string>;

export const LEDGER_NOTE_MAX = 200;

export function isLedgerType(value: string): value is LedgerType {
  return (LEDGER_TYPES as readonly string[]).includes(value);
}

export function ledgerDirection(type: LedgerType): LedgerDirection {
  return type === "trip_income" ? "income" : "deduction";
}

export type LedgerTotals = {
  incomeCents: number;
  deductionCents: number;
  netCents: number;
};

export function ledgerTotals(
  entries: readonly { type: LedgerType; amountCents: number }[]
): LedgerTotals {
  let incomeCents = 0;
  let deductionCents = 0;
  for (const entry of entries) {
    if (ledgerDirection(entry.type) === "income") incomeCents += entry.amountCents;
    else deductionCents += entry.amountCents;
  }
  return {
    incomeCents,
    deductionCents,
    netCents: incomeCents - deductionCents,
  };
}

export function formatUsdFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

/** Dollar text from the admin form, such as 125.50, as a positive cent count. */
export function dollarsToCents(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 13) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

export function centsToDollarInput(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents) % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function todayEastern(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function currentMonthEastern(now: Date = new Date()): string {
  return todayEastern(now).slice(0, 7);
}

export function formatMonthLabel(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

/** Inclusive start and exclusive end for a YYYY-MM month, compared as dates. */
export function monthBounds(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const start = `${month}-01`;
  const end =
    monthIndex === 12
      ? `${year + 1}-01-01`
      : `${month.slice(0, 5)}${String(monthIndex + 1).padStart(2, "0")}-01`;
  return { start, end };
}
