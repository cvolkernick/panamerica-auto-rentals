import { missingHeaders, parseCsv } from "./csv";
import { turoMapper, TURO_REQUIRED_HEADERS } from "./turo";
import type { ImportUpload, PlatformMapper } from "./types";
import {
  wheelbaseMapper,
  WHEELBASE_RESERVATION_HEADERS,
  WHEELBASE_TRANSACTION_HEADERS,
} from "./wheelbase";

export const DEFAULT_MAPPERS: readonly PlatformMapper[] = [turoMapper, wheelbaseMapper];

export function mapperByPlatform(
  platform: string,
  mappers: readonly PlatformMapper[] = DEFAULT_MAPPERS
): PlatformMapper | null {
  const key = platform.trim().toLowerCase();
  return mappers.find((mapper) => mapper.platform === key) ?? null;
}

export function selectMapper(
  upload: ImportUpload,
  mappers: readonly PlatformMapper[] = DEFAULT_MAPPERS
): { ok: true; mapper: PlatformMapper } | { ok: false; error: string } {
  if (upload.file && (upload.reservations || upload.transactions)) {
    return { ok: false, error: "Send either one trip CSV or the two Wheelbase files." };
  }
  if (upload.platform) {
    const mapper = mapperByPlatform(upload.platform, mappers);
    if (!mapper) return { ok: false, error: `Unknown platform "${upload.platform}".` };
    return { ok: true, mapper };
  }
  if (upload.reservations || upload.transactions) {
    const wheelbase = mappers.find((mapper) => mapper.platform === "wheelbase");
    if (!wheelbase) return { ok: false, error: "Wheelbase import is not available." };
    return { ok: true, mapper: wheelbase };
  }
  if (!upload.file) return { ok: false, error: "Choose a CSV to import." };
  const parsed = parseCsv(upload.file.text);
  if (!parsed.ok) return parsed;
  const turo = mappers.find((mapper) => mapper.platform === "turo");
  if (turo?.canParse("single", parsed.table.headers)) return { ok: true, mapper: turo };
  const wheelbase = mappers.find((mapper) => mapper.platform === "wheelbase");
  if (
    wheelbase?.canParse("reservations", parsed.table.headers) ||
    wheelbase?.canParse("transactions", parsed.table.headers)
  ) {
    return { ok: false, error: "Wheelbase needs both the reservations file and the transaction log." };
  }
  if (missingHeaders(parsed.table.headers, TURO_REQUIRED_HEADERS).length > 0) {
    const reservationHits = WHEELBASE_RESERVATION_HEADERS.some((header) =>
      parsed.table.headers.includes(header)
    );
    const transactionHits = WHEELBASE_TRANSACTION_HEADERS.some((header) =>
      parsed.table.headers.includes(header)
    );
    if (reservationHits || transactionHits) {
      return { ok: false, error: "Wheelbase needs both the reservations file and the transaction log." };
    }
  }
  return {
    ok: false,
    error: "These headers do not match Turo or Wheelbase. Nothing was imported.",
  };
}
