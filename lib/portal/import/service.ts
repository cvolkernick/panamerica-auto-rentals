import type { PortalD1 } from "../d1";
import { matchMappedTrip } from "./match";
import { DEFAULT_MAPPERS, selectMapper } from "./registry";
import type { ImportUpload, PlatformMapper } from "./types";
import {
  importFilename,
  importReviewPayload,
  insertReviewItem,
  insertTripImport,
  insertTripImportRow,
} from "../money-store";

const MAX_TRIPS = 20_000;

export async function createImportPreview(
  db: PortalD1,
  actorId: number,
  upload: ImportUpload,
  mappers: readonly PlatformMapper[] = DEFAULT_MAPPERS
): Promise<
  | { ok: true; payload: NonNullable<Awaited<ReturnType<typeof importReviewPayload>>> }
  | { ok: false; status: number; error: string }
> {
  const selected = selectMapper(upload, mappers);
  if (!selected.ok) return { ok: false, status: 400, error: selected.error };
  const parsed = selected.mapper.parse({
    file: upload.file,
    reservations: upload.reservations,
    transactions: upload.transactions,
  });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  if (parsed.value.trips.length > MAX_TRIPS) {
    return { ok: false, status: 400, error: "That file has too many trip rows." };
  }
  const names = [upload.file?.filename, upload.reservations?.filename, upload.transactions?.filename].filter(
    (name): name is string => Boolean(name)
  );
  const importId = await insertTripImport(
    db,
    selected.mapper.platform,
    importFilename(names),
    parsed.value.trips.length,
    actorId
  );
  for (const trip of parsed.value.trips) {
    const hit = await matchMappedTrip(db, selected.mapper.platform, trip);
    await insertTripImportRow(db, importId, {
      rowNumber: trip.rowNumber,
      externalTripId: trip.externalTripId,
      externalVehicleId: trip.externalVehicleId,
      vin: trip.vin,
      plate: trip.plate,
      startAt: trip.startAt,
      endAt: trip.endAt,
      startDate: trip.startDate,
      endDate: trip.endDate,
      status: trip.status,
      grossCents: trip.grossCents,
      platformFeesCents: trip.platformFeesCents,
      payoutCents: trip.payoutCents,
      taxCents: trip.taxCents,
      pendingPayoutCents: trip.pendingPayoutCents,
      hasPending: trip.hasPending,
      countsAsIncome: hit.matchStatus === "invalid" ? false : trip.countsAsIncome,
      matchStatus: hit.matchStatus,
      carId: hit.carId,
      error: hit.error,
    });
  }
  for (const item of parsed.value.reviewItems) {
    await insertReviewItem(db, importId, item);
  }
  const payload = await importReviewPayload(db, importId);
  if (!payload) return { ok: false, status: 500, error: "server_error" };
  return { ok: true, payload };
}
