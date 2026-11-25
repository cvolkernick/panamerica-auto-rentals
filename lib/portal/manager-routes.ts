/**
 * Admin-only manager routes (phase 1). The caller has already checked isAdmin and CSRF.
 *
 *   GET   /api/portal/admin/managers                  list + current cars + accrued share
 *   POST  /api/portal/admin/managers                  { name, email, shareBps, effectiveFrom } (new account + first rate)
 *                                                     or { name, ownerId, confirm: true, shareBps, effectiveFrom } (existing account)
 *   GET   /api/portal/admin/managers/:id              manager, rate history, assignment history, accrual
 *   PATCH /api/portal/admin/managers/:id              { name } (share changes go through rates)
 *   GET   /api/portal/admin/managers/:id/rates        dated share history
 *   POST  /api/portal/admin/managers/:id/rates        { shareBps, effectiveFrom } forward only
 *   PATCH /api/portal/admin/managers/:id/rates/:rateId { effectiveFrom } correct the FIRST rate's start date only
 *   POST  /api/portal/admin/managers/:id/account      { email } new login account for an unlinked manager
 *   POST  /api/portal/admin/managers/:id/link         { ownerId, confirm: true } explicit link to an existing account
 *   POST  /api/portal/admin/managers/:id/invite       one-time invite for the linked account (/manager/invite/);
 *                                                     { reset: true } required if the account already has a password
 *   GET   /api/portal/admin/cars/:id/managers         car's manager history (newest first)
 *   POST  /api/portal/admin/cars/:id/managers         { managerId | null, startDate }
 *   POST  /api/portal/admin/cars/:id/managers/undo    undo the last assignment change
 */
import { getCarById, getOwnerByEmail, getOwnerById, getPasswordHash, uniqueField } from "./db";
import type { PortalD1 } from "./d1";
import { json, readJson, readOptionalJson, validationError } from "./http";
import { createOwnerInvite, MANAGER_INVITE_URL_PREFIX } from "./invite";
import { todayEastern } from "./ledger";
import {
  assignmentJson,
  closeAssignment,
  createAccountForManager,
  deleteAssignment,
  firstRateMoveError,
  moveFirstRate,
  parseFirstRateMove,
  getManagerByAccount,
  linkManagerAccount,
  parseAccountCreate,
  parseAccountLink,
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
  parseManagerFromAccount,
  insertManagerForAccount,
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

function accountConflict(): Response {
  // No owner id or name in the reply: the admin must pick and confirm the account explicitly.
  return json(
    {
      error: "conflict",
      reason: "email_has_account",
      fields: {
        email:
          "That email already has a portal account. It was not linked. To use it, link that exact account by id and confirm.",
      },
    },
    409
  );
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

/** New manager on an existing account the admin picked and confirmed (dual role). */
async function createManagerForAccount(db: PortalD1, value: unknown, actorId: number): Promise<Response> {
  const parsed = parseManagerFromAccount(value);
  if (!parsed.ok) return validationError(parsed.fields);
  if (!(await getOwnerById(db, parsed.value.ownerId))) return validationError({ ownerId: "Account not found." });
  if (await getManagerByAccount(db, parsed.value.ownerId)) {
    return json({ error: "conflict", reason: "account_has_manager" }, 409);
  }
  try {
    const id = await insertManagerForAccount(db, parsed.value, actorId);
    const row = await getManager(db, id);
    if (!row) return json({ error: "server_error" }, 500);
    return json({ manager: managerJson(row, await listRates(db, id), todayEastern()) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (duplicateName(error) && !/account_id/i.test(message)) {
      return json({ error: "conflict", fields: { name: "A manager with this name already exists." } }, 409);
    }
    if (/UNIQUE/i.test(message)) return json({ error: "conflict", reason: "account_has_manager" }, 409);
    throw error;
  }
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
      const fromAccount =
        typeof body.value === "object" && body.value !== null && "ownerId" in (body.value as Record<string, unknown>);
      if (fromAccount) return createManagerForAccount(db, body.value, actorId);
      const parsed = parseManagerCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      // Email match must never auto-link an existing account (docs/manager-role.md).
      if (await getOwnerByEmail(db, parsed.value.email)) return accountConflict();
      try {
        const id = await insertManager(db, parsed.value, actorId);
        const row = await getManager(db, id);
        if (!row) return json({ error: "server_error" }, 500);
        return json({ manager: managerJson(row, await listRates(db, id), todayEastern()) }, 201);
      } catch (error) {
        if (uniqueField(error) === "email") return accountConflict();
        if (duplicateName(error)) {
          return json({ error: "conflict", fields: { name: "A manager with this name already exists." } }, 409);
        }
        throw error;
      }
    }
    return methodNotAllowed("GET, POST");
  }

  const accountMatch = path.match(/^\/api\/portal\/admin\/managers\/([1-9]\d*)\/(account|link|invite)$/);
  if (accountMatch) {
    const id = parsePathId(accountMatch[1]);
    if (id === null) return notFound();
    const existing = await getManager(db, id);
    if (!existing) return notFound();
    if (method !== "POST") return methodNotAllowed("POST");
    const action = accountMatch[2];
    if (action === "invite") {
      if (existing.account_id == null) return json({ error: "conflict", reason: "manager_not_linked" }, 409);
      const accountId = Number(existing.account_id);
      // An account that already has a password signs in as it does today. Like the owner
      // invite, an admin may still issue a new link (it replaces the password once used), but
      // only with an explicit { reset: true }, so a linked owner's password is never reset by accident.
      if (await getPasswordHash(db, accountId)) {
        const reset = await readOptionalJson(request);
        if (reset?.reset !== true) return json({ error: "conflict", reason: "account_has_password" }, 409);
      }
      return createOwnerInvite(db, accountId, new Date(), MANAGER_INVITE_URL_PREFIX);
    }
    if (existing.account_id != null) return json({ error: "conflict", reason: "manager_already_linked" }, 409);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (action === "account") {
      const parsed = parseAccountCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      if (await getOwnerByEmail(db, parsed.value.email)) return accountConflict();
      try {
        const linked = await createAccountForManager(db, id, existing.name, parsed.value.email);
        if (!linked) return json({ error: "conflict", reason: "manager_already_linked" }, 409);
      } catch (error) {
        if (uniqueField(error) === "email") return accountConflict();
        throw error;
      }
    } else {
      const parsed = parseAccountLink(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      if (!(await getOwnerById(db, parsed.value.ownerId))) {
        return validationError({ ownerId: "Account not found." });
      }
      if (await getManagerByAccount(db, parsed.value.ownerId)) {
        return json({ error: "conflict", reason: "account_has_manager" }, 409);
      }
      try {
        const changed = await linkManagerAccount(db, id, parsed.value.ownerId);
        if (changed !== 1) return json({ error: "conflict", reason: "manager_already_linked" }, 409);
          } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) return json({ error: "conflict", reason: "account_has_manager" }, 409);
        throw error;
      }
    }
    const row = await getManager(db, id);
    if (!row) return notFound();
    return json(await managerDetail(db, row));
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

  const rateMatch = path.match(/^\/api\/portal\/admin\/managers\/([1-9]\d*)\/rates\/([1-9]\d*)$/);
  if (rateMatch) {
    const id = parsePathId(rateMatch[1]);
    const rateId = parsePathId(rateMatch[2]);
    if (id === null || rateId === null) return notFound();
    const existing = await getManager(db, id);
    if (!existing) return notFound();
    if (method !== "PATCH") return methodNotAllowed("PATCH");
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = parseFirstRateMove(body.value);
    if (!parsed.ok) return validationError(parsed.fields);
    const [rates, assignments] = await Promise.all([listRates(db, id), listAssignmentsForManager(db, id)]);
    const check = firstRateMoveError(rates, assignments, rateId, parsed.value.effectiveFrom);
    if (!check.ok) return check.status === 404 ? notFound() : validationError(check.fields);
    const changed = await moveFirstRate(db, id, rateId, check.from, parsed.value.effectiveFrom);
    // Something changed between the check and the write (a rate or an assignment): ask to reload.
    if (changed !== 1) return json({ error: "conflict", reason: "rates_changed" }, 409);
    return json(await managerDetail(db, existing));
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
              ? `Use ${first.effective_from} or later, when this manager's first share rate starts. If they started earlier, correct their start date on the managers page first.`
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
