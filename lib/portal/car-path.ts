/** Plate key for /admin/cars/<plate>. Spaces and dashes are ignored when matching. */
export function normalizePlateKey(value: string): string {
  return value.toUpperCase().replace(/ /g, "").replace(/-/g, "");
}

/** `id-<id>` is the page key for a car with no plate. Leading zeros are not an id. */
export function carIdFromAdminKey(key: string): number | null {
  const match = /^id-([1-9]\d*)$/i.exec(key.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export function carAdminKey(car: { id: number; licensePlate: string }): string {
  const plate = car.licensePlate.trim();
  if (!plate) return `id-${car.id}`;
  return plate;
}

export function carAdminHref(car: { id: number; licensePlate: string }): string {
  return `/admin/cars/${encodeURIComponent(carAdminKey(car))}/`;
}

/** Plate or id key from the browser path. The static shell is always /admin/cars/. */
export function plateKeyFromPath(pathname: string): string | null {
  const trimmed = pathname.replace(/\/+$/, "");
  const prefix = "/admin/cars/";
  if (!trimmed.startsWith(prefix)) return null;
  const raw = trimmed.slice(prefix.length);
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
