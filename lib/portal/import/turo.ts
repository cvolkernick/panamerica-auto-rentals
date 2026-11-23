import { normalizePlateKey } from "../car-path";
import { missingHeaders, parseCsv, rowRecord } from "./csv";
import { parseTuroStamp } from "./dates";
import { parseMoneyToCents } from "./money";
import type { MappedTrip, MapperInput, PlatformMapper, ReviewItem } from "./types";

/** Confirmed 47-column Turo trip earnings export, in file order. */
export const TURO_HEADERS = [
  "Reservation ID",
  "Guest",
  "Vehicle",
  "Vehicle name",
  "Vehicle id",
  "VIN",
  "Trip start",
  "Trip end",
  "Pickup location",
  "Return location",
  "Trip status",
  "Check-in odometer",
  "Check-out odometer",
  "Distance traveled",
  "Trip days",
  "Trip price",
  "Boost price",
  "3-day discount",
  "1-week discount",
  "2-week discount",
  "3-week discount",
  "1-month discount",
  "2-month discount",
  "3-month discount",
  "Non-refundable discount",
  "Early bird discount",
  "Host promotional credit",
  "Delivery",
  "Excess distance",
  "Extras",
  "Cancellation fee",
  "Additional usage",
  "Late fee",
  "Improper return fee",
  "Airport operations fee",
  "Airport parking credit",
  "Tolls & tickets",
  "On-trip EV charging",
  "Post-trip EV charging",
  "Smoking",
  "Cleaning",
  "Fines (paid to host)",
  "Gas reimbursement",
  "Gas fee",
  "Other fees",
  "Sales tax",
  "Total earnings",
] as const;

export const TURO_REQUIRED_HEADERS = [
  "Reservation ID",
  "VIN",
  "Vehicle",
  "Vehicle id",
  "Trip start",
  "Trip end",
  "Trip status",
  "Trip price",
  "Total earnings",
] as const;

export function normalizeVin(value: string | null | undefined): string | null {
  if (!value) return null;
  const vin = value.toUpperCase().replace(/[\s-]/g, "");
  return vin.length > 0 ? vin : null;
}

/** Last parenthetical group on the Vehicle listing, normalized like a plate key. */
export function plateFromVehicle(vehicle: string): string | null {
  const matches = vehicle.match(/\(([^)]*)\)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const inner = last.slice(1, -1).trim();
  const plate = normalizePlateKey(inner);
  return plate || null;
}

export function turoCountsAsIncome(status: string, payoutCents: number): boolean {
  if (status === "Completed") return true;
  if (status === "Guest cancellation" || status === "Host cancellation") return payoutCents !== 0;
  return false;
}

function clip(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= max ? text : text.slice(0, max);
}

/** Remove guest and location cells before any other field is read. */
export function dropGuestFields(record: Record<string, string>): void {
  delete record.Guest;
  delete record["Pickup location"];
  delete record["Return location"];
}

function mapRow(record: Record<string, string>, rowNumber: number): MappedTrip {
  dropGuestFields(record);

  const externalTripId = clip(record["Reservation ID"] ?? "", 64);
  const vehicleId = clip(record["Vehicle id"] ?? "", 64);
  const vin = normalizeVin(record.VIN);
  const plate = plateFromVehicle(record.Vehicle ?? "");
  const status = clip(record["Trip status"] ?? "", 80);
  const start = parseTuroStamp(record["Trip start"] ?? "");
  const end = parseTuroStamp(record["Trip end"] ?? "");
  const gross = parseMoneyToCents(record["Trip price"] ?? "");
  const payout = parseMoneyToCents(record["Total earnings"] ?? "");

  let error: string | null = null;
  if (!externalTripId) error = "missing_trip_id";
  else if (!status) error = "missing_status";
  else if (!start || !end) error = "bad_date";
  else if (gross === null || payout === null) error = "bad_money";

  return {
    rowNumber,
    externalTripId: externalTripId || null,
    externalVehicleId: vehicleId || null,
    vin,
    plate,
    plateCandidates: plate ? [plate] : [],
    startAt: start?.text ?? null,
    endAt: end?.text ?? null,
    startDate: start?.date ?? null,
    endDate: end?.date ?? null,
    status: status || null,
    grossCents: gross,
    platformFeesCents: null,
    payoutCents: payout,
    taxCents: null,
    pendingPayoutCents: 0,
    hasPending: false,
    countsAsIncome: error === null && payout !== null && status ? turoCountsAsIncome(status, payout) : false,
    error,
  };
}

function parseTuro(input: MapperInput): { ok: true; value: { trips: MappedTrip[]; reviewItems: ReviewItem[] } } | { ok: false; error: string } {
  if (!input.file) return { ok: false, error: "Turo needs the trip earnings CSV." };
  if (input.reservations || input.transactions) {
    return { ok: false, error: "Turo takes one trip earnings file." };
  }
  const parsed = parseCsv(input.file.text);
  if (!parsed.ok) return parsed;
  const missing = missingHeaders(parsed.table.headers, TURO_REQUIRED_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `This Turo file is missing required columns: ${missing.join(", ")}.`,
    };
  }
  const seen = new Set<string>();
  const trips = parsed.table.rows.map((cells, index) => {
    const trip = mapRow(rowRecord(parsed.table.headers, cells), index + 2);
    if (trip.externalTripId) {
      const key = trip.externalTripId.toLowerCase();
      if (seen.has(key)) trip.error = "duplicate_trip_id";
      else seen.add(key);
    }
    if (trip.error) trip.countsAsIncome = false;
    return trip;
  });
  return { ok: true, value: { trips, reviewItems: [] } };
}

export const turoMapper: PlatformMapper = {
  platform: "turo",
  label: "Turo",
  canParse(kind, headers) {
    return kind === "single" && missingHeaders(headers, TURO_REQUIRED_HEADERS).length === 0;
  },
  parse: parseTuro,
};
