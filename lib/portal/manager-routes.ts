/**
 * Admin-only manager routes (phase 1). The caller has already checked isAdmin and CSRF.
 *
 *   GET   /api/portal/admin/managers                  list + current cars + accrued share
 *   POST  /api/portal/admin/managers                  { name, shareBps, effectiveFrom } (seeds the first rate)
 *   GET   /api/portal/admin/managers/:id              manager, rate history, assignment history, accrual
 *   PATCH /api/portal/admin/managers/:id              { name } (share changes go through rates)
 *   GET   /api/portal/admin/managers/:id/rates        dated share history
 *   POST  /api/portal/admin/managers/:id/rates        { shareBps, effectiveFrom } forward only
 *   GET   /api/portal/admin/cars/:id/managers         car's manager history (newest first)
 *   POST  /api/portal/admin/cars/:id/managers         { managerId | null, startDate }
 *   POST  /api/portal/admin/cars/:id/managers/undo    undo the last assignment change
 */
import { getCarById } from "./db";
import type { PortalD1 } from "./d1";
import { json, readJson, validationError } from "./http";
import { todayEastern } from "./ledger";
import {
  assignmentJson,
  closeAssignment,
  deleteAssignment,
  getManager,
  insertAssignment,
  insertManager,
  insertRate,
  listAllAssignments,
  listAllRates,
  listRates,
  listAssignmentsForCar,
  listAssignmentsForManager,
  listManagers,
  managerAccrual,
  managerJson,
  parseAssignment,
  parseManagerCreate,
  parseManagerPatch,
  parseRateCreate,
  planAssignment,
  rateJson,
  rateWriteError,
  reassign,
  reopenAssignment,
  undoReassign,
  updateManagerName,
  type ManagerRow,
} from "./managers";

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { allow });
}

function parsePathId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function duplicateName(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE/i.test(message) && /managers\.name|name/i.test(message);
}

function openAssignmentConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE/i.test(message) && /car_manager_assignments|car_id/i.test(message);
}

async function managerDetail(db: PortalD1, manager: ManagerRow) {
  const [assignments, rates] = await Promise.all([
    listAssignmentsForManager(db, Number(manager.id)),
    listRates(db, Number(manager.id)),
  ]);
  const accrual = await managerAccrual(db, rates, assignments);
  return {
    manager: managerJson(manager, rates, todayEastern()),
    assignments: assignments.map(assignmentJson),
    accrual,
  };
}

async function carManagers(db: PortalD1, carId: number) {
  const history = await listAssignmentsForCar(db, carId);
  const current = history.find((row) => row.end_date === null) ?? null;
  return {
    carId,
    current: current ? assignmentJson(current) : null,
    history: history.map(assignmentJson),
  };
}

export async function routeAdminManagers(
  request: Request,
  db: PortalD1,
  path: string,
  method: string,
  actorId: number
): Promise<Response | null> {
  if (path === "/api/portal/admin/managers") {
    if (method === "GET") {
      const [managers, assignments, allRates] = await Promise.all([
        listManagers(db),
        listAllAssignments(db),
        listAllRates(db),
      ]);
      const today = todayEastern();
      const rows = [];
      for (const manager of managers) {
        const mine = assignments.filter((row) => Number(row.manager_id) === Number(manager.id));
        const rates = allRates.filter((row) => Number(row.manager_id) === Number(manager.id));
        const accrual = await managerAccrual(db, rates, mine);
        rows.push({
          ...managerJson(manager, rates, today),
          currentCars: mine.filter((row) => row.end_date === null).map(assignmentJson),
          accruedCents: accrual.accruedCents,
          feeCents: accrual.feeCents,
          tripCount: accrual.tripCount,
        });
      }
      return json({
        managers: rows,
        currentAssignments: assignments.filter((row) => row.end_date === null).map(assignmentJson),
      });
    }
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseManagerCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      try {
        const id = await insertManager(db, parsed.value, actorId);
        const row = await getManager(db, id);
        if (!row) return json({ error: "server_error" }, 500);
        return json({ manager: managerJson(row, await listRates(db, id), todayEastern()) }, 201);
      } catch (error) {
        if (duplicateName(error)) {
          return json({ error: "conflict", fields: { name: "A manager with this name already exists." } }, 409);
        }
        throw error;
      }
    }
    return methodNotAllowed("GET, POST");
  }

  const managerMatch = path.match(/^\/api\/portal\/admin\/managers\/([1-9]\d*)$/);
  if (managerMatch) {
    const id = parsePathId(managerMatch[1]);
    if (id === null) return notFound();
    const existing = await getManager(db, id);
    if (!existing) return notFound();
    if (method === "GET") return json(await managerDetail(db, existing));
    if (method === "PATCH") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseManagerPatch(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      try {
        await updateManagerName(db, id, parsed.value.name);
      } catch (error) {
        if (duplicateName(error)) {
          return json({ error: "conflict", fields: { name: "A manager with this name already exists." } }, 409);
        }
        throw error;
      }
      const row = await getManager(db, id);
      if (!row) return notFound();
      return json(await managerDetail(db, row));
    }
    return methodNotAllowed("GET, PATCH");
  }

  const ratesMatch = path.match(/^\/api\/portal\/admin\/managers\/([1-9]\d*)\/rates$/);
  if (ratesMatch) {
    const id = parsePathId(ratesMatch[1]);
    if (id === null) return notFound();
    const existing = await getManager(db, id);
    if (!existing) return notFound();
    if (method === "GET") return json({ rates: (await listRates(db, id)).map(rateJson) });
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseRateCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      const blocked = rateWriteError(await listRates(db, id), parsed.value);
      if (blocked) return validationError(blocked);
      try {
        await insertRate(db, id, parsed.value, actorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) {
          return validationError({ effectiveFrom: `A rate already starts on ${parsed.value.effectiveFrom}.` });
        }
        throw error;
      }
      return json(await managerDetail(db, existing), 201);
    }
    return methodNotAllowed("GET, POST");
  }

  const undoMatch = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/managers\/undo$/);
  if (undoMatch) {
    const carId = parsePathId(undoMatch[1]);
    if (carId === null) return notFound();
    if (!(await getCarById(db, carId))) return notFound();
    if (method !== "POST") return methodNotAllowed("POST");
    // History is newest first: start_date DESC, id DESC.
    const history = await listAssignmentsForCar(db, carId);
    const latest = history[0];
    if (!latest) return json({ error: "conflict", reason: "no_assignment_history" }, 409);
    if (latest.end_date !== null) {
      // Last change was an unassign: reopen it.
      await reopenAssignment(db, Number(latest.id));
    } else {
      const previous = history[1];
      if (previous && previous.end_date === latest.start_date) {
        await undoReassign(db, carId, Number(latest.id), Number(previous.id));
      } else {
        await deleteAssignment(db, carId, Number(latest.id));
      }
    }
    return json(await carManagers(db, carId));
  }

  const carMatch = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/managers$/);
  if (carMatch) {
    const carId = parsePathId(carMatch[1]);
    if (carId === null) return notFound();
    if (!(await getCarById(db, carId))) return notFound();
    if (method === "GET") return json(await carManagers(db, carId));
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseAssignment(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      if (parsed.value.managerId !== null) {
        if (!(await getManager(db, parsed.value.managerId))) {
          return validationError({ managerId: "Manager not found." });
        }
        // Every day a manager has a car must have a share rate in effect.
        const first = (await listRates(db, parsed.value.managerId))[0];
        if (!first || parsed.value.startDate < first.effective_from) {
          return validationError({
            startDate: first
              ? `Use ${first.effective_from} or later, when this manager's first share rate starts.`
              : "This manager has no share rate yet.",
          });
        }
      }
      const history = await listAssignmentsForCar(db, carId);
      const plan = planAssignment(history, parsed.value);
      if (!plan.ok) return validationError(plan.fields);
      try {
        if (plan.close && plan.open) {
          await reassign(db, plan.close, { carId, ...plan.open }, actorId);
        } else if (plan.close) {
          await closeAssignment(db, plan.close.id, plan.close.endDate);
        } else if (plan.open) {
          await insertAssignment(db, carId, plan.open.managerId, plan.open.startDate, actorId);
        }
      } catch (error) {
        if (openAssignmentConflict(error)) return json({ error: "conflict", reason: "car_has_manager" }, 409);
        throw error;
      }
      return json(await carManagers(db, carId), plan.open ? 201 : 200);
    }
    return methodNotAllowed("GET, POST");
  }

  return null;
}
