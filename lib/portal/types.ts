import type { ExpenseCategory } from "./expenses";
import type { LedgerType } from "./ledger";

export type OwnerJson = {
  id: number;
  name: string;
  email: string;
  /** Effective admin: stored flag, or the email is listed in ADMIN_EMAILS. */
  isAdmin: boolean;
  /** The owners.is_admin column. The admin form edits this. */
  storedAdmin: boolean;
  createdAt: string;
};

export type LedgerEntryJson = {
  id: number;
  carId: number;
  entryDate: string;
  type: LedgerType;
  amountCents: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
};

export type LedgerTotalsJson = {
  incomeCents: number;
  deductionCents: number;
  netCents: number;
};

export type ExpenseJson = {
  id: number;
  carId: number;
  entryDate: string;
  category: ExpenseCategory;
  amountCents: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
};

export type MoneyTotalsJson = {
  payoutCents: number;
  taxCents: number | null;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  grossCents: number | null;
  platformFeesCents: number | null;
  pendingPayoutCents: number;
  pendingTripCount: number;
};

export type MoneyTripJson = {
  id: number;
  platform: string;
  externalTripId: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  countsAsIncome: boolean;
  grossCents: number | null;
  platformFeesCents: number | null;
  payoutCents: number;
  taxCents: number | null;
  pendingPayoutCents: number | null;
  hasPending: boolean;
};

export type MoneyReportJson = {
  month: string;
  attribution: string;
  monthTotals: MoneyTotalsJson;
  toDate: MoneyTotalsJson;
  allTime: MoneyTotalsJson;
  platforms: {
    platform: string;
    payoutCents: number;
    taxCents: number | null;
    incomeCents: number;
  }[];
  trips: MoneyTripJson[];
  expenses: ExpenseJson[];
};

export type CarJson = {
  id: number;
  ownerId: number;
  year: number;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
  createdAt: string;
  updatedAt: string;
  ownerName?: string;
  ownerEmail?: string;
};

/** Every role that applies to the signed-in account. Owner and manager can both be true. */
/** Admin owners list row: the account plus its owner and manager roles (admin-only JSON). */
export type AdminAccountJson = OwnerJson & { roles?: { owner: boolean; manager: boolean } };

export type SessionRoles = {
  roles: { admin: boolean; owner: boolean; manager: boolean };
  /** Set only when a managers row has account_id = this account. */
  managerId: number | null;
};

export type SessionJson = {
  email: string;
  owner: OwnerJson;
  csrfToken: string;
} & Partial<SessionRoles>;

export type PortalAuth = {
  email: string;
  owner: OwnerJson;
  csrfToken: string;
  devBypass: boolean;
};

export type PortalErrorJson = {
  error: string;
  reason?: string;
  email?: string;
  fields?: Record<string, string>;
};

export type CarStatementJson = Awaited<
  ReturnType<typeof import("./statement-store").carStatement>
>;

export type StatementJson = CarStatementJson["statement"];

export type StatementHistoryJson = CarStatementJson["history"][number];

export type PayoutJson = ReturnType<typeof import("./statement-store").payoutJson>;
