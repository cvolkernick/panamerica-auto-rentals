import { normalizePlateKey } from "../car-path";
import { missingHeaders, parseCsv, rowRecord } from "./csv";
import { classifyDeposit, clockFromSeconds, isIsoDate } from "./dates";
import { parseMoneyOrZero, parseMoneyToCents } from "./money";
import type { MappedTrip, MapperInput, PlatformMapper, ReviewItem } from "./types";

export const WHEELBASE_RESERVATION_HEADERS = [
  "Booking ID",
  "Status",
  "Vehicle Internal ID",
  "Start",
  "End",
  "Start Time",
  "End Time",
  "Subtotal",
] as const;

export const WHEELBASE_TRANSACTION_HEADERS = [
  "Date",
  "Deposit Date",
  "Reservation",
  "Type",
  "Amount",
  "CC Fee",
  "Wheelbase Fee",
  "Credit",
  "Debit",
] as const;

export const WHEELBASE_KNOWN_TYPES = [
  "Full Reservation Charge",
  "Manual Charge",
  "Wheelbase Fee Payment",
] as const;

const KNOWN_TYPES = new Set<string>(WHEELBASE_KNOWN_TYPES);

const TRANSACTION_DETAIL_KEYS = [
  "Date",
  "Deposit Date",
  "Type",
  "Charge Type",
  "Amount",
  "CC Fee",
  "Outdoorsy Remitted Taxes",
  "Wheelbase Fee",
  "Renter Fee",
  "Renter Services Fee",
  "International Transaction Fee",
  "Credit",
  "Debit",
  "Partner Commission",
] as const;

const RESERVATION_DETAIL_KEYS = [
  "Booking ID",
  "Status",
  "Source",
  "Rental ID",
  "Rental Name",
  "Vehicle Internal ID",
  "Start",
  "End",
  "Start Time",
  "End Time",
  "Nights",
  "Rental Amount",
  "Subtotal",
  "Total",
  "Amount Paid",
  "Due",
] as const;

export function bookingIdFromReservation(value: string): string | null {
  const match = /^#([A-Za-z0-9_-]+)/.exec(value.trim());
  return match ? match[1] : null;
}

export function wheelbasePlates(internalId: string): { plate: string | null; candidates: string[] } {
  const raw = internalId.trim();
  if (!raw) return { plate: null, candidates: [] };
  const full = normalizePlateKey(raw);
  const hyphen = raw.lastIndexOf("-");
  const fallbackRaw = hyphen >= 0 ? raw.slice(hyphen + 1).trim() : "";
  const fallback = fallbackRaw ? normalizePlateKey(fallbackRaw) : "";
  const candidates = [full, fallback].filter(
    (value, index, all) => value.length > 0 && all.indexOf(value) === index
  );
  return { plate: raw, candidates };
}

export function plateFallbackText(plate: string | null): string | null {
  if (!plate) return null;
  const hyphen = plate.lastIndexOf("-");
  if (hyphen < 0) return null;
  const fallback = plate.slice(hyphen + 1).trim();
  if (!fallback || normalizePlateKey(fallback) === normalizePlateKey(plate)) return null;
  return fallback;
}

function taxHeader(header: string): boolean {
  return header.trim().endsWith("Tax");
}

function detailFrom(
  record: Record<string, string>,
  keys: readonly string[],
  extra: Record<string, string>
): Record<string, string> {
  const detail: Record<string, string> = {};
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key].trim();
    if (value) detail[key] = value.slice(0, 200);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) detail[key] = value.slice(0, 200);
  }
  return detail;
}

function clip(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= max ? text : text.slice(0, max);
}

type KnownTxn = {
  bookingId: string;
  credit: number;
  debit: number;
  ccFee: number;
  wheelbaseFee: number;
  pending: boolean;
};

function wheelbaseCountsAsIncome(status: string, payoutCents: number): boolean {
  const normalized = status.trim().toLowerCase();
  if (normalized === "returned" || normalized === "completed" || normalized === "complete") return true;
  if (normalized.includes("cancel")) return payoutCents !== 0;
  return payoutCents !== 0;
}

function parseWheelbase(
  input: MapperInput
): { ok: true; value: { trips: MappedTrip[]; reviewItems: ReviewItem[] } } | { ok: false; error: string } {
  if (input.file || !input.reservations || !input.transactions) {
    return { ok: false, error: "Wheelbase needs both the bookings file and the transactions file." };
  }
  const reservations = parseCsv(input.reservations.text);
  if (!reservations.ok) return { ok: false, error: `Reservations file: ${reservations.error}` };
  const transactions = parseCsv(input.transactions.text);
  if (!transactions.ok) return { ok: false, error: `Transactions file: ${transactions.error}` };
  const missingReservations = missingHeaders(reservations.table.headers, WHEELBASE_RESERVATION_HEADERS);
  if (missingReservations.length > 0) {
    return {
      ok: false,
      error: `The reservations file is missing required columns: ${missingReservations.join(", ")}.`,
    };
  }
  const missingTransactions = missingHeaders(transactions.table.headers, WHEELBASE_TRANSACTION_HEADERS);
  if (missingTransactions.length > 0) {
    return {
      ok: false,
      error: `The transactions file is missing required columns: ${missingTransactions.join(", ")}.`,
    };
  }

  const taxColumns = reservations.table.headers.filter(taxHeader);
  const reviewItems: ReviewItem[] = [];
  const knownByBooking = new Map<string, KnownTxn[]>();
  const bookingsWithRows = new Set<string>();

  transactions.table.rows.forEach((cells, index) => {
    const record = rowRecord(transactions.table.headers, cells);
    const rowNumber = index + 2;
    const bookingId = bookingIdFromReservation(record.Reservation ?? "");
    const typeRaw = (record.Type ?? "").trim();
    if (!bookingId) {
      reviewItems.push({
        rowNumber,
        kind: "unmatched_booking",
        externalTripId: null,
        typeRaw: typeRaw || null,
        detail: detailFrom(record, TRANSACTION_DETAIL_KEYS, { reason: "reservation_id_unparsed" }),
      });
      return;
    }
    bookingsWithRows.add(bookingId);
    if (!KNOWN_TYPES.has(typeRaw)) {
      reviewItems.push({
        rowNumber,
        kind: "unknown_type",
        externalTripId: bookingId,
        typeRaw: typeRaw || null,
        detail: detailFrom(record, TRANSACTION_DETAIL_KEYS, { bookingId }),
      });
      return;
    }
    const deposit = classifyDeposit(record["Deposit Date"] ?? "");
    const credit = parseMoneyOrZero(record.Credit ?? "");
    const debit = parseMoneyOrZero(record.Debit ?? "");
    const ccFee = parseMoneyOrZero(record["CC Fee"] ?? "");
    const wheelbaseFee = parseMoneyOrZero(record["Wheelbase Fee"] ?? "");
    if (deposit === "bad" || credit === null || debit === null || ccFee === null || wheelbaseFee === null) {
      reviewItems.push({
        rowNumber,
        kind: "unparsed",
        externalTripId: bookingId,
        typeRaw,
        detail: detailFrom(record, TRANSACTION_DETAIL_KEYS, { bookingId, reason: "unparsed_amount_or_date" }),
      });
      return;
    }
    const bucket = knownByBooking.get(bookingId) ?? [];
    bucket.push({
      bookingId,
      credit,
      debit,
      ccFee,
      wheelbaseFee,
      pending: deposit === "pending",
    });
    knownByBooking.set(bookingId, bucket);
  });

  const seen = new Set<string>();
  const trips: MappedTrip[] = [];
  reservations.table.rows.forEach((cells, index) => {
    const record = rowRecord(reservations.table.headers, cells);
    const rowNumber = index + 2;
    const bookingId = clip(record["Booking ID"] ?? "", 64);
    if (!bookingId) {
      trips.push(invalidTrip(rowNumber, null, "missing_trip_id"));
      return;
    }
    if (seen.has(bookingId.toLowerCase())) {
      trips.push(invalidTrip(rowNumber, bookingId, "duplicate_trip_id"));
      return;
    }
    seen.add(bookingId.toLowerCase());
    const known = knownByBooking.get(bookingId) ?? [];
    if (!bookingsWithRows.has(bookingId)) {
      reviewItems.push({
        rowNumber,
        kind: "unmatched_booking",
        externalTripId: bookingId,
        typeRaw: null,
        detail: detailFrom(record, RESERVATION_DETAIL_KEYS, { reason: "no_transactions" }),
      });
      return;
    }
    if (known.length === 0) {
      reviewItems.push({
        rowNumber,
        kind: "unmatched_booking",
        externalTripId: bookingId,
        typeRaw: null,
        detail: detailFrom(record, RESERVATION_DETAIL_KEYS, {
          reason: "no_known_transaction_types",
        }),
      });
      return;
    }
    const status = clip(record.Status ?? "", 80);
    const startDate = (record.Start ?? "").trim();
    const endDate = (record.End ?? "").trim();
    const startClock = clockFromSeconds(record["Start Time"] ?? "");
    const endClock = clockFromSeconds(record["End Time"] ?? "");
    const gross = parseMoneyToCents(record.Subtotal ?? "");
    let tax = 0;
    let taxOk = true;
    for (const header of taxColumns) {
      const parsed = parseMoneyOrZero(record[header] ?? "");
      if (parsed === null) taxOk = false;
      else tax += parsed;
    }
    const plates = wheelbasePlates(record["Vehicle Internal ID"] ?? "");
    let credit = 0;
    let debit = 0;
    let fees = 0;
    let pendingNet = 0;
    let hasPending = false;
    for (const txn of known) {
      credit += txn.credit;
      debit += txn.debit;
      fees += txn.ccFee + txn.wheelbaseFee;
      if (txn.pending) {
        hasPending = true;
        pendingNet += txn.credit - txn.debit;
      }
    }
    const payout = credit - debit;
    let error: string | null = null;
    if (!status) error = "missing_status";
    else if (!isIsoDate(startDate) || !isIsoDate(endDate) || !startClock || !endClock) error = "bad_date";
    else if (gross === null || !taxOk) error = "bad_money";
    trips.push({
      rowNumber,
      externalTripId: bookingId,
      externalVehicleId: null,
      vin: null,
      plate: plates.plate,
      plateCandidates: plates.candidates,
      startAt: isIsoDate(startDate) && startClock ? `${startDate} ${startClock}` : null,
      endAt: isIsoDate(endDate) && endClock ? `${endDate} ${endClock}` : null,
      startDate: isIsoDate(startDate) ? startDate : null,
      endDate: isIsoDate(endDate) ? endDate : null,
      status: status || null,
      grossCents: gross,
      platformFeesCents: fees,
      payoutCents: payout,
      taxCents: taxOk ? tax : null,
      pendingPayoutCents: pendingNet,
      hasPending,
      countsAsIncome: error === null && status ? wheelbaseCountsAsIncome(status, payout) : false,
      error,
    });
  });

  for (const bookingId of bookingsWithRows) {
    if (seen.has(bookingId.toLowerCase())) continue;
    reviewItems.push({
      rowNumber: null,
      kind: "unmatched_booking",
      externalTripId: bookingId,
      typeRaw: null,
      detail: { bookingId, reason: "no_reservation" },
    });
  }

  return { ok: true, value: { trips, reviewItems } };
}

function invalidTrip(rowNumber: number, externalTripId: string | null, error: string): MappedTrip {
  return {
    rowNumber,
    externalTripId,
    externalVehicleId: null,
    vin: null,
    plate: null,
    plateCandidates: [],
    startAt: null,
    endAt: null,
    startDate: null,
    endDate: null,
    status: null,
    grossCents: null,
    platformFeesCents: null,
    payoutCents: null,
    taxCents: null,
    pendingPayoutCents: 0,
    hasPending: false,
    countsAsIncome: false,
    error,
  };
}

export const wheelbaseMapper: PlatformMapper = {
  platform: "wheelbase",
  label: "Wheelbase",
  canParse(kind, headers) {
    if (kind === "reservations") return missingHeaders(headers, WHEELBASE_RESERVATION_HEADERS).length === 0;
    if (kind === "transactions") return missingHeaders(headers, WHEELBASE_TRANSACTION_HEADERS).length === 0;
    return false;
  },
  parse: parseWheelbase,
};
