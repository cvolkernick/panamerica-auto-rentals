import type { PortalD1 } from "../d1";
import type { MappedTrip } from "./types";

export type MatchStatus = "matched" | "unmatched" | "ambiguous" | "invalid";

export type MatchHit = {
  matchStatus: MatchStatus;
  carId: number | null;
  error: string | null;
};

type IdRow = { id: number };
type CarIdRow = { car_id: number };

/**
 * First unique hit wins: remembered platform vehicle id, then VIN, then plate.
 * A non-empty VIN that misses does not fall through to the plate.
 * Wheelbase plate candidates are full value, then the text after the last hyphen.
 */
export async function matchMappedTrip(
  db: PortalD1,
  platform: string,
  trip: MappedTrip
): Promise<MatchHit> {
  if (trip.error) return { matchStatus: "invalid", carId: null, error: trip.error };
  if (trip.externalVehicleId) {
    const remembered = await db
      .prepare(
        `SELECT car_id FROM car_platform_ids WHERE platform = ? AND external_vehicle_id = ?`
      )
      .bind(platform, trip.externalVehicleId)
      .first<CarIdRow>();
    if (remembered) return { matchStatus: "matched", carId: Number(remembered.car_id), error: null };
  }
  if (trip.vin) {
    const vin = await db
      .prepare(
        `SELECT id FROM cars WHERE REPLACE(REPLACE(UPPER(vin), ' ', ''), '-', '') = ?`
      )
      .bind(trip.vin)
      .first<IdRow>();
    if (vin) return { matchStatus: "matched", carId: Number(vin.id), error: null };
    return { matchStatus: "unmatched", carId: null, error: "unknown_vin" };
  }
  let ambiguous = false;
  for (let index = 0; index < trip.plateCandidates.length; index += 1) {
    const plate = trip.plateCandidates[index];
    if (!plate) continue;
    const found = await db
      .prepare(
        `SELECT id FROM cars WHERE REPLACE(REPLACE(UPPER(license_plate), ' ', ''), '-', '') = ? ORDER BY id`
      )
      .bind(plate)
      .all<IdRow>();
    if (found.results.length === 1) {
      return { matchStatus: "matched", carId: Number(found.results[0].id), error: null };
    }
    if (found.results.length > 1) {
      ambiguous = true;
      if (index === 0) return { matchStatus: "ambiguous", carId: null, error: "ambiguous_plate" };
    }
  }
  if (ambiguous) return { matchStatus: "ambiguous", carId: null, error: "ambiguous_plate" };
  return {
    matchStatus: "unmatched",
    carId: null,
    error: trip.plateCandidates.length > 0 ? "unmatched_plate" : "no_vehicle_key",
  };
}
