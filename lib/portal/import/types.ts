export type CsvFile = {
  filename: string;
  text: string;
  bytes: number;
};

export type ImportUpload = {
  platform: string | null;
  file: CsvFile | null;
  reservations: CsvFile | null;
  transactions: CsvFile | null;
};

export type MapperInput = {
  file?: CsvFile | null;
  reservations?: CsvFile | null;
  transactions?: CsvFile | null;
};

export type MappedTrip = {
  rowNumber: number;
  externalTripId: string | null;
  externalVehicleId: string | null;
  vin: string | null;
  plate: string | null;
  plateCandidates: string[];
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  grossCents: number | null;
  platformFeesCents: number | null;
  payoutCents: number | null;
  taxCents: number | null;
  pendingPayoutCents: number | null;
  hasPending: boolean;
  countsAsIncome: boolean;
  error: string | null;
};

export type ReviewKind = "unknown_type" | "unmatched_booking" | "unparsed";

export type ReviewItem = {
  rowNumber: number | null;
  kind: ReviewKind;
  externalTripId: string | null;
  typeRaw: string | null;
  detail: Record<string, string>;
};

export type MapperSuccess = {
  trips: MappedTrip[];
  reviewItems: ReviewItem[];
};

export type PlatformMapper = {
  platform: string;
  label: string;
  canParse(kind: "single" | "reservations" | "transactions", headers: readonly string[]): boolean;
  parse(input: MapperInput): { ok: true; value: MapperSuccess } | { ok: false; error: string };
};
