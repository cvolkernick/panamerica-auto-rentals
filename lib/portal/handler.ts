import {
  carJson,
  countStoredAdmins,
  deleteCar,
  getCarById,
  getOwnedCar,
  getOwnerById,
  insertCar,
  insertOwner,
  listAllCars,
  listOwnedCars,
  listOwners,
  ownerJson,
  uniqueField,
  updateCar,
  updateOwner,
  type CarRow,
  type OwnerRow,
} from "./db";
import type { PortalD1 } from "./d1";
import type { PortalEnv } from "./env";
import { portalApexRedirect } from "./hosts";
import { forbidden, json, readJson, validationError } from "./http";
import { createOwnerInvite, handleInvite } from "./invite";
import { authenticate, handleLogin, handleLogout, handleSetupPassword, requireCsrf } from "./login";
import {
  parseCarCreate,
  parseCarPatch,
  parseOwnerCreate,
  parseOwnerPatch,
  type CarWrite,
  type OwnerWrite,
} from "./validate";

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { allow });
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function parsePathId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  return id;
}

function requireDb(env: PortalEnv): PortalD1 | Response {
  if (!env.DB) return json({ error: "database_unconfigured" }, 500);
  return env.DB;
}

async function withUnique(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    const field = uniqueField(error);
    if (field === "vin") {
      return json(
        { error: "conflict", fields: { vin: "A car with this VIN already exists." } },
        409
      );
    }
    if (field === "email") {
      return json(
        {
          error: "conflict",
          fields: { email: "An owner with this email already exists." },
        },
        409
      );
    }
    throw error;
  }
}

function ownerWriteFromRow(row: OwnerRow, patch: Partial<OwnerWrite>): OwnerWrite {
  return {
    name: patch.name ?? row.name,
    email: patch.email ?? row.email.trim().toLowerCase(),
    storedAdmin:
      patch.storedAdmin !== undefined ? patch.storedAdmin : Number(row.is_admin) === 1,
  };
}

function carWriteFromRow(row: CarRow, patch: Partial<CarWrite>): CarWrite {
  return {
    ownerId: patch.ownerId ?? Number(row.owner_id),
    year: patch.year ?? Number(row.year),
    make: patch.make ?? row.make,
    model: patch.model ?? row.model,
    color: patch.color ?? row.color,
    licensePlate: patch.licensePlate ?? row.license_plate,
    vin: patch.vin ?? row.vin,
  };
}

async function ensureOwner(db: PortalD1, ownerId: number): Promise<Response | null> {
  const owner = await getOwnerById(db, ownerId);
  if (!owner) return validationError({ ownerId: "Owner not found." });
  return null;
}

export async function handlePortal(request: Request, env: PortalEnv): Promise<Response> {
  try {
    const redirect = portalApexRedirect(request);
    if (redirect) return redirect;
    return await route(request, env);
  } catch (error) {
    console.error(error instanceof Error ? error.name : "portal_error");
    return json({ error: "server_error" }, 500);
  }
}

async function route(request: Request, env: PortalEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  if (!path.startsWith("/api/portal")) return notFound();

  const dbOrResponse = requireDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  if (path === "/api/portal/login") return handleLogin(request, env, db);
  if (path === "/api/portal/setup-password") return handleSetupPassword(request, env, db);
  if (path === "/api/portal/invite") return handleInvite(request, env, db);

  const auth = await authenticate(request, env, db);
  if (auth instanceof Response) return auth;

  if (path === "/api/portal/logout") return handleLogout(request, db, auth);

  if (method !== "GET" && method !== "HEAD") {
    const denied = await requireCsrf(request, auth);
    if (denied) return denied;
  }

  if (path === "/api/portal/session") {
    if (method !== "GET") return methodNotAllowed("GET");
    return json({ email: auth.email, owner: auth.owner, csrfToken: auth.csrfToken });
  }

  if (path === "/api/portal/cars") {
    if (method !== "GET") return methodNotAllowed("GET");
    const cars = await listOwnedCars(db, auth.owner.id);
    return json({ cars: cars.map(carJson) });
  }

  const ownedCar = path.match(/^\/api\/portal\/cars\/([1-9]\d*)$/);
  if (ownedCar) {
    if (method !== "GET") return methodNotAllowed("GET");
    const id = parsePathId(ownedCar[1]);
    if (id === null) return notFound();
    const car = await getOwnedCar(db, id, auth.owner.id);
    if (!car) return notFound();
    return json({ car: carJson(car) });
  }

  if (path.startsWith("/api/portal/admin")) {
    if (!auth.owner.isAdmin) return forbidden("not_admin");
    return routeAdmin(request, db, env, path, method);
  }

  return notFound();
}

async function routeAdmin(
  request: Request,
  db: PortalD1,
  env: PortalEnv,
  path: string,
  method: string
): Promise<Response> {
  if (path === "/api/portal/admin/owners") {
    if (method === "GET") {
      const owners = await listOwners(db);
      return json({ owners: owners.map((row) => ownerJson(row, env)) });
    }
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseOwnerCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      return withUnique(async () => {
        const id = await insertOwner(db, parsed.value);
        const row = await getOwnerById(db, id);
        if (!row) return json({ error: "server_error" }, 500);
        return json({ owner: ownerJson(row, env) }, 201);
      });
    }
    return methodNotAllowed("GET, POST");
  }

  const inviteMatch = path.match(/^\/api\/portal\/admin\/owners\/([1-9]\d*)\/invite$/);
  if (inviteMatch) {
    const id = parsePathId(inviteMatch[1]);
    if (id === null) return notFound();
    if (method !== "POST") return methodNotAllowed("POST");
    return createOwnerInvite(db, id);
  }

  const ownerMatch = path.match(/^\/api\/portal\/admin\/owners\/([1-9]\d*)$/);
  if (ownerMatch) {
    const id = parsePathId(ownerMatch[1]);
    if (id === null) return notFound();
    if (method === "GET") {
      const row = await getOwnerById(db, id);
      if (!row) return notFound();
      return json({ owner: ownerJson(row, env) });
    }
    if (method === "PATCH") {
      const existing = await getOwnerById(db, id);
      if (!existing) return notFound();
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseOwnerPatch(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      const next = ownerWriteFromRow(existing, parsed.value);
      if (Number(existing.is_admin) === 1 && !next.storedAdmin) {
        const admins = await countStoredAdmins(db);
        if (admins <= 1) {
          return validationError({
            storedAdmin: "At least one admin is required.",
          });
        }
      }
      return withUnique(async () => {
        await updateOwner(db, id, next);
        const row = await getOwnerById(db, id);
        if (!row) return notFound();
        return json({ owner: ownerJson(row, env) });
      });
    }
    return methodNotAllowed("GET, PATCH");
  }

  if (path === "/api/portal/admin/cars") {
    if (method === "GET") {
      const cars = await listAllCars(db);
      return json({ cars: cars.map(carJson) });
    }
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseCarCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      const missing = await ensureOwner(db, parsed.value.ownerId);
      if (missing) return missing;
      return withUnique(async () => {
        const id = await insertCar(db, parsed.value);
        const row = await getCarById(db, id);
        if (!row) return json({ error: "server_error" }, 500);
        return json({ car: carJson(row) }, 201);
      });
    }
    return methodNotAllowed("GET, POST");
  }

  const carMatch = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)$/);
  if (carMatch) {
    const id = parsePathId(carMatch[1]);
    if (id === null) return notFound();
    if (method === "GET") {
      const row = await getCarById(db, id);
      if (!row) return notFound();
      return json({ car: carJson(row) });
    }
    if (method === "PATCH") {
      const existing = await getCarById(db, id);
      if (!existing) return notFound();
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseCarPatch(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      const next = carWriteFromRow(existing, parsed.value);
      const missing = await ensureOwner(db, next.ownerId);
      if (missing) return missing;
      return withUnique(async () => {
        await updateCar(db, id, next);
        const row = await getCarById(db, id);
        if (!row) return notFound();
        return json({ car: carJson(row) });
      });
    }
    if (method === "DELETE") {
      const existing = await getCarById(db, id);
      if (!existing) return notFound();
      await deleteCar(db, id);
      return json({ ok: true });
    }
    return methodNotAllowed("GET, PATCH, DELETE");
  }

  return notFound();
}
