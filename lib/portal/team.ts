/**
 * Team connector API: /api/portal/team/*.
 *
 * Team agents (through the car-connector MCP) read and write car records with one
 * scoped service token, PORTAL_TEAM_TOKEN, sent as a Bearer header, plus the calling
 * agent's name in X-Agent-Name. Every write lands in team_write_log with that name.
 *
 * Scope, on purpose:
 * - Cars: list, read, edit details. No create, no delete, no owner reassignment.
 * - Expenses: list, add, edit. Delete only rows the connector itself created.
 * - Income: list all trips; add, edit, and delete only manual (connector) income.
 *   Imported Turo/Wheelbase trips are read-only here; they change by re-import.
 * - Statements: read-only. No payouts, no period close, no owner or guest data.
 * - Managers: read-only lookup of which manager runs each car today (name, since,
 *   contact_ref "manager:<id>", portal-account flag) and owner_type company/client.
 *   No owner names, no emails, no phone numbers.
 * The management fee, carry-forward, and payout-due figures are computed by the
 * statement code from these rows; nothing here sets them.
 *
 * X-Agent-Name is self-asserted by the caller. It is a label for the write log only;
 * nothing is authorized on it. The token is the only credential.
 *
 * Two tokens:
 * - PORTAL_TEAM_TOKEN (full): everything above. Required; unset or short disables the API (404).
 * - PORTAL_TEAM_READ_TOKEN (read, optional): GET routes only. Any other method answers
 *   403 {"error":"read_only_token"} before touching D1 or the write log. Unset, empty or
 *   short never matches, so a blank Bearer can never pass as the read token.
 */
import { carJson, getCarById, listAllCars, uniqueField, type CarRow } from "./db";
import type { PortalD1 } from "./d1";
import type { PortalEnv } from "./env";
import { clientIp } from "./hosts";
import { json, rateLimited, readJson, unauthorized, validationError } from "./http";
import { currentMonthEastern, monthBounds, todayEastern } from "./ledger";
import { expenseJson, getExpense, listExpenses, type ExpenseRow } from "./money-store";
import { secretsEqual } from "./secrets";
import { carStatement } from "./statement-store";
import {
  connectorCreated,
  deleteExpenseStatement,
  getCarManager,
  listCarManagers,
  deleteManualIncomeStatement,
  getIncome,
  incomeJson,
  insertExpenseStatement,
  insertManualIncomeStatement,
  listIncome,
  listWriteLog,
  MANUAL_PLATFORM,
  MAX_ENTRY_CENTS,
  newManualTripId,
  runLogged,
  teamActorId,
  updateCarStatement,
  updateExpenseStatement,
  updateManualIncomeStatement,
  writeLogJson,
  writeLogStatement,
  type IncomeRow,
  type IncomeWrite,
} from "./team-store";
import {
  parseCarPatch,
  parseExpenseCreate,
  parseExpensePatch,
  parseLedgerMonth,
  type ExpenseWrite,
  type FieldErrors,
} from "./validate";

export const TEAM_PREFIX = "/api/portal/team";
export const AGENT_HEADER = "x-agent-name";
export const MIN_TEAM_TOKEN_LENGTH = 32;
export const AGENT_NAME_MAX = 80;
const MAX_INCOME_DAYS = 366;
const MAX_LOG_LIMIT = 200;

export function isTeamPath(path: string): boolean {
  return path === TEAM_PREFIX || path.startsWith(`${TEAM_PREFIX}/`);
}

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

/** Agent label from X-Agent-Name. Percent-encoding is decoded so names can carry emoji. */
export function parseAgentName(raw: string | null): string | null {
  if (raw === null) return null;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/[\u0000-\u001F\u007F]/.test(text)) return null;
  text = text.trim().replace(/ +/g, " ");
  if (!text || text.length > AGENT_NAME_MAX) return null;
  return text;
}

const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_LIKE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

/** Notes are for receipts and vendors. Refuse anything that looks like a person's email or phone. */
export function noteLooksLikePii(note: string | null | undefined): boolean {
  if (!note) return false;
  return EMAIL_LIKE.test(note) || PHONE_LIKE.test(note);
}

/** Car JSON for the connector: no owner name or email (ownerId only). Used for reads and the write log. */
export function teamCarJson(row: CarRow) {
  const car = carJson(row);
  delete car.ownerEmail;
  delete car.ownerName;
  return car;
}

/**
 * Basic per-isolate rate limit for /api/portal/team. Each Worker isolate keeps its own
 * window, so this is a brake on runaway loops, not a global quota.
 */
export const TEAM_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120, maxAuthFailures: 10 } as const;
const rateWindows = new Map<string, { start: number; requests: number; failures: number }>();

function rateWindow(key: string, now: number) {
  let window = rateWindows.get(key);
  if (!window || now - window.start >= TEAM_RATE_LIMIT.windowMs) {
    window = { start: now, requests: 0, failures: 0 };
    rateWindows.set(key, window);
    if (rateWindows.size > 5000) {
      for (const [k, w] of rateWindows) if (now - w.start >= TEAM_RATE_LIMIT.windowMs) rateWindows.delete(k);
    }
  }
  return window;
}

/** Test hook. */
export function resetTeamRateLimit(): void {
  rateWindows.clear();
}

export type TeamScope = "full" | "read";

export const TEAM_SCOPES: Record<TeamScope, string> = {
  full: "cars:read,cars:write,expenses:write,income:write,statements:read,managers:read",
  read: "cars:read,expenses:read,income:read,statements:read,managers:read,write_log:read",
};

/** Read-only token callers may use GET only. */
export function readTokenAllows(method: string): boolean {
  return method.toUpperCase() === "GET";
}

async function authorize(request: Request, env: PortalEnv): Promise<{ agent: string; scope: TeamScope } | Response> {
  const expected = env.PORTAL_TEAM_TOKEN?.trim() ?? "";
  if (expected.length < MIN_TEAM_TOKEN_LENGTH) return notFound();
  const readExpected = env.PORTAL_TEAM_READ_TOKEN?.trim() ?? "";
  const readEnabled = readExpected.length >= MIN_TEAM_TOKEN_LENGTH;
  const window = rateWindow(clientIp(request), Date.now());
  if (window.failures >= TEAM_RATE_LIMIT.maxAuthFailures) return rateLimited();
  window.requests += 1;
  if (window.requests > TEAM_RATE_LIMIT.maxRequests) return rateLimited();
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(header.trim());
  let scope: TeamScope | null = null;
  if (match) {
    // Always run both compares so timing does not reveal which token (if any) matched.
    const [isFull, isRead] = await Promise.all([
      secretsEqual(match[1], expected),
      secretsEqual(match[1], readEnabled ? readExpected : expected),
    ]);
    if (isFull) scope = "full";
    else if (readEnabled && isRead) scope = "read";
  }
  if (!scope) {
    window.failures += 1;
    return unauthorized("team_token");
  }
  if (scope === "read" && !readTokenAllows(request.method)) {
    return json({ error: "read_only_token", reason: "This token is read-only. Only GET is allowed." }, 403);
  }
  const agent = parseAgentName(request.headers.get(AGENT_HEADER));
  if (!agent) {
    return json(
      {
        error: "agent_name_required",
        reason: `Send the calling agent's name in X-Agent-Name (1-${AGENT_NAME_MAX} characters, percent-encoded if needed).`,
      },
      400
    );
  }
  return { agent, scope };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalCents(value: unknown, field: string, fields: FieldErrors, allowZero: boolean): number | null | undefined {
  if (value === undefined || value === null) return null;
  const amount = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    fields[field] = "Enter a whole number of cents.";
    return undefined;
  }
  if (amount > MAX_ENTRY_CENTS) {
    fields[field] = `At most ${MAX_ENTRY_CENTS} cents per entry.`;
    return undefined;
  }
  return amount;
}

function requiredCents(value: unknown, field: string, fields: FieldErrors): number | undefined {
  const amount = typeof value === "string" && /^[1-9]\d*$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    fields[field] = "Enter a positive whole number of cents.";
    return undefined;
  }
  if (amount > MAX_ENTRY_CENTS) {
    fields[field] = `At most ${MAX_ENTRY_CENTS} cents per entry.`;
    return undefined;
  }
  return amount;
}

function isoDay(value: unknown, field: string, fields: FieldErrors): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fields[field] = "Use a real date as YYYY-MM-DD.";
    return undefined;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1980 || y > 2100 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    fields[field] = "Use a real date as YYYY-MM-DD.";
    return undefined;
  }
  return value;
}

const INCOME_FIELDS = ["startDate", "endDate", "payoutCents", "grossCents", "platformFeesCents", "taxCents"];

/**
 * Manual income is one trip's platform net payout (what the platform actually paid out).
 * The trip length from startDate to endDate picks the fee tier; the statement figures the fee.
 */
export function parseIncome(
  body: unknown,
  base: IncomeWrite | null
): { ok: true; value: IncomeWrite } | { ok: false; fields: FieldErrors } {
  if (!isRecord(body)) return { ok: false, fields: { body: "Expected an object." } };
  const fields: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!INCOME_FIELDS.includes(key)) fields[key] = "Not a field the connector can set.";
  }
  if (base && !INCOME_FIELDS.some((key) => key in body)) fields.body = "Nothing to update.";
  const pick = <T>(key: string, parse: () => T | undefined, fallback: T | undefined): T | undefined =>
    key in body || !base ? parse() : fallback;
  const startDate = pick("startDate", () => isoDay(body.startDate, "startDate", fields), base?.startDate);
  const endDate = pick("endDate", () => isoDay(body.endDate, "endDate", fields), base?.endDate);
  const payoutCents = pick("payoutCents", () => requiredCents(body.payoutCents, "payoutCents", fields), base?.payoutCents);
  const grossCents = pick("grossCents", () => optionalCents(body.grossCents, "grossCents", fields, false), base?.grossCents ?? null);
  const platformFeesCents = pick(
    "platformFeesCents",
    () => optionalCents(body.platformFeesCents, "platformFeesCents", fields, true),
    base?.platformFeesCents ?? null
  );
  const taxCents = pick("taxCents", () => optionalCents(body.taxCents, "taxCents", fields, true), base?.taxCents ?? null);
  if (startDate && endDate) {
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
    if (days < 0) fields.endDate = "End date must be on or after the start date.";
    else if (days > MAX_INCOME_DAYS) fields.endDate = `A trip can be at most ${MAX_INCOME_DAYS} days.`;
  }
  if (payoutCents !== undefined && taxCents !== undefined && taxCents !== null && taxCents >= payoutCents) {
    fields.taxCents = "Pass-through tax must be less than the payout.";
  }
  if (
    Object.keys(fields).length > 0 ||
    startDate === undefined ||
    endDate === undefined ||
    payoutCents === undefined ||
    grossCents === undefined ||
    platformFeesCents === undefined ||
    taxCents === undefined
  ) {
    return { ok: false, fields };
  }
  return { ok: true, value: { startDate, endDate, payoutCents, grossCents, platformFeesCents, taxCents } };
}

function incomeWriteFromRow(row: IncomeRow): IncomeWrite {
  return {
    startDate: row.start_date,
    endDate: row.end_date ?? row.start_date,
    payoutCents: Number(row.payout_cents),
    grossCents: row.gross_cents === null ? null : Number(row.gross_cents),
    platformFeesCents: row.platform_fees_cents === null ? null : Number(row.platform_fees_cents),
    taxCents: row.tax_cents === null ? null : Number(row.tax_cents),
  };
}

function expenseGuard(value: Partial<ExpenseWrite>): FieldErrors | null {
  if (value.amountCents !== undefined && value.amountCents > MAX_ENTRY_CENTS) {
    return { amountCents: `At most ${MAX_ENTRY_CENTS} cents per entry.` };
  }
  if (value.category === "commission") {
    return {
      category:
        "The management fee is figured by the statement from trip income. The connector does not book commission expenses.",
    };
  }
  if (noteLooksLikePii(value.note)) {
    return { note: "Leave out emails and phone numbers. Notes are for the vendor and what the expense was." };
  }
  return null;
}

function commissionLocked(): Response {
  return json(
    {
      error: "forbidden",
      reason: "commission_row",
      detail: "Commission rows are admin-only. The connector cannot edit, recategorize, or delete them.",
    },
    403
  );
}

function expenseWriteFromRow(row: ExpenseRow, patch: Partial<ExpenseWrite>): ExpenseWrite {
  return {
    entryDate: patch.entryDate ?? row.entry_date,
    category: patch.category ?? row.category,
    amountCents: patch.amountCents ?? Number(row.amount_cents),
    note: patch.note !== undefined ? patch.note : row.note,
  };
}

function monthParam(request: Request): { ok: true; value: string | null } | { ok: false; response: Response } {
  const parsed = parseLedgerMonth(new URL(request.url).searchParams.get("month"));
  if (!parsed.ok) return { ok: false, response: validationError(parsed.fields) };
  return { ok: true, value: parsed.value };
}

function constraintResponse(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/CHECK constraint failed/i.test(message)) return validationError({ body: "That entry is not valid." });
  if (/FOREIGN KEY constraint failed/i.test(message)) return json({ error: "conflict", reason: "foreign_key" }, 409);
  return null;
}

export async function handleTeam(request: Request, env: PortalEnv, db: PortalD1, path: string): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;
  const agent = auth.agent;
  const method = request.method.toUpperCase();
  const rest = path.slice(TEAM_PREFIX.length) || "/";

  if (rest === "/whoami") {
    if (method !== "GET") return methodNotAllowed("GET");
    return json({ agentName: agent, tokenScope: auth.scope, scope: TEAM_SCOPES[auth.scope] });
  }

  if (rest === "/write-log") {
    if (method !== "GET") return methodNotAllowed("GET");
    const params = new URL(request.url).searchParams;
    const carRaw = params.get("carId");
    const carId = carRaw === null ? undefined : parsePathId(carRaw.trim());
    if (carId === null) return validationError({ carId: "Use a car id." });
    const limitRaw = Number(params.get("limit") ?? "50");
    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LOG_LIMIT) : 50;
    const rows = await listWriteLog(db, { carId, limit });
    return json({ entries: rows.map(writeLogJson) });
  }

  if (rest === "/cars") {
    if (method !== "GET") return methodNotAllowed("GET");
    const cars = await listAllCars(db);
    return json({ cars: cars.map(teamCarJson) });
  }

  if (rest === "/managers/assignments") {
    if (method !== "GET") return methodNotAllowed("GET");
    const today = todayEastern();
    return json({ as_of: today, assignments: await listCarManagers(db, env, today) });
  }

  const managerMatch = /^\/cars\/([1-9]\d*)\/manager$/.exec(rest);
  if (managerMatch) {
    if (method !== "GET") return methodNotAllowed("GET");
    const id = parsePathId(managerMatch[1]);
    if (id === null) return notFound();
    const today = todayEastern();
    const row = await getCarManager(db, env, id, today);
    if (!row) return json({ error: "car_not_found" }, 404);
    return json({ as_of: today, ...row });
  }

  const match = /^\/cars\/([1-9]\d*)(?:\/(expenses|income|statement)(?:\/([1-9]\d*))?)?$/.exec(rest);
  if (!match) return notFound();
  const carId = parsePathId(match[1]);
  if (carId === null) return notFound();
  const car = await getCarById(db, carId);
  if (!car) return json({ error: "car_not_found" }, 404);
  const section = match[2];
  const entityId = match[3] ? parsePathId(match[3]) : null;
  if (match[3] && entityId === null) return notFound();

  if (!section) {
    if (method === "GET") return json({ car: teamCarJson(car) });
    if (method === "PATCH") return patchCar(request, db, car, agent);
    return methodNotAllowed("GET, PATCH");
  }

  if (section === "statement") {
    if (entityId !== null) return notFound();
    if (method !== "GET") return methodNotAllowed("GET");
    const month = monthParam(request);
    if (!month.ok) return month.response;
    const current = currentMonthEastern();
    return json(await carStatement(db, car, month.value ?? current, current));
  }

  const actorId = await teamActorId(db);
  if (actorId === null && method === "POST") return json({ error: "server_error", reason: "no_admin_owner" }, 500);

  if (section === "expenses") {
    if (entityId === null) {
      if (method === "GET") {
        const month = monthParam(request);
        if (!month.ok) return month.response;
        const rows = await listExpenses(db, carId, month.value ? monthBounds(month.value) : undefined);
        return json({ expenses: rows.map(expenseJson), month: month.value });
      }
      if (method === "POST") return createExpense(request, db, carId, actorId as number, agent);
      return methodNotAllowed("GET, POST");
    }
    const existing = await getExpense(db, carId, entityId);
    if (!existing) return notFound();
    if (method === "GET") return json({ expense: expenseJson(existing) });
    if ((method === "PATCH" || method === "DELETE") && existing.category === "commission") return commissionLocked();
    if (method === "PATCH") return patchExpense(request, db, carId, existing, agent);
    if (method === "DELETE") {
      if (!(await connectorCreated(db, "expense.create", carId, entityId))) {
        return json(
          { error: "forbidden", reason: "not_connector_entry", detail: "The connector only deletes expenses it created. Ask an admin." },
          403
        );
      }
      const [, logId] = await runLogged(
        db,
        deleteExpenseStatement(db, carId, entityId),
        writeLogStatement(db, {
          agentName: agent,
          action: "expense.delete",
          carId,
          entityId,
          before: expenseJson(existing),
          after: null,
        })
      );
      return json({ ok: true, writeLogId: logId });
    }
    return methodNotAllowed("GET, PATCH, DELETE");
  }

  // income
  if (entityId === null) {
    if (method === "GET") {
      const month = monthParam(request);
      if (!month.ok) return month.response;
      const rows = await listIncome(db, carId, month.value ? monthBounds(month.value) : undefined);
      return json({ income: rows.map(incomeJson), month: month.value });
    }
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseIncome(body.value, null);
      if (!parsed.ok) return validationError(parsed.fields);
      const externalTripId = newManualTripId();
      let ids: number[];
      try {
        ids = await runLogged(
          db,
          insertManualIncomeStatement(db, carId, externalTripId, parsed.value),
          writeLogStatement(db, {
            agentName: agent,
            action: "income.create",
            carId,
            entityId: "last_insert",
            before: null,
            after: { carId, platform: MANUAL_PLATFORM, externalTripId, ...parsed.value },
          })
        );
      } catch (error) {
        const denied = constraintResponse(error);
        if (denied) return denied;
        throw error;
      }
      const row = await getIncome(db, carId, ids[0]);
      if (!row) return json({ error: "server_error" }, 500);
      return json({ income: incomeJson(row), writeLogId: ids[1] }, 201);
    }
    return methodNotAllowed("GET, POST");
  }
  const existingIncome = await getIncome(db, carId, entityId);
  if (!existingIncome) return notFound();
  if (method === "GET") return json({ income: incomeJson(existingIncome) });
  if (method !== "PATCH" && method !== "DELETE") return methodNotAllowed("GET, PATCH, DELETE");
  if (existingIncome.platform.toLowerCase() !== MANUAL_PLATFORM) {
    return json(
      { error: "forbidden", reason: "imported_trip", detail: "Imported trips are read-only here. Fix them with a corrected re-import." },
      403
    );
  }
  if (method === "DELETE") {
    if (!(await connectorCreated(db, "income.create", carId, entityId))) {
      return json({ error: "forbidden", reason: "not_connector_entry" }, 403);
    }
    const [, logId] = await runLogged(
      db,
      deleteManualIncomeStatement(db, carId, entityId),
      writeLogStatement(db, {
        agentName: agent,
        action: "income.delete",
        carId,
        entityId,
        before: incomeJson(existingIncome),
        after: null,
      })
    );
    return json({ ok: true, writeLogId: logId });
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseIncome(body.value, incomeWriteFromRow(existingIncome));
  if (!parsed.ok) return validationError(parsed.fields);
  const before = incomeJson(existingIncome);
  let ids: number[];
  try {
    ids = await runLogged(
      db,
      updateManualIncomeStatement(db, carId, entityId, parsed.value),
      writeLogStatement(db, {
        agentName: agent,
        action: "income.update",
        carId,
        entityId,
        before,
        after: { ...before, ...parsed.value },
      })
    );
  } catch (error) {
    const denied = constraintResponse(error);
    if (denied) return denied;
    throw error;
  }
  const updated = await getIncome(db, carId, entityId);
  if (!updated) return notFound();
  return json({ income: incomeJson(updated), writeLogId: ids[1] });
}

async function patchCar(request: Request, db: PortalD1, car: CarRow, agent: string): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (isRecord(body.value) && "ownerId" in body.value) {
    return validationError({ ownerId: "The connector cannot move a car to another owner." });
  }
  const parsed = parseCarPatch(body.value);
  if (!parsed.ok) return validationError(parsed.fields);
  const next = {
    year: parsed.value.year ?? Number(car.year),
    make: parsed.value.make ?? car.make,
    model: parsed.value.model ?? car.model,
    color: parsed.value.color ?? car.color,
    licensePlate: parsed.value.licensePlate ?? car.license_plate,
    vin: parsed.value.vin ?? car.vin,
  };
  const before = teamCarJson(car);
  let ids: number[];
  try {
    ids = await runLogged(
      db,
      updateCarStatement(db, Number(car.id), next),
      writeLogStatement(db, {
        agentName: agent,
        action: "car.update",
        carId: Number(car.id),
        entityId: Number(car.id),
        before,
        after: { ...before, ...next },
      })
    );
  } catch (error) {
    if (uniqueField(error) === "vin") {
      return json({ error: "conflict", fields: { vin: "A car with this VIN already exists." } }, 409);
    }
    throw error;
  }
  const row = await getCarById(db, Number(car.id));
  if (!row) return notFound();
  return json({ car: teamCarJson(row), writeLogId: ids[1] });
}

async function createExpense(
  request: Request,
  db: PortalD1,
  carId: number,
  actorId: number,
  agent: string
): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseExpenseCreate(body.value);
  if (!parsed.ok) return validationError(parsed.fields);
  const guard = expenseGuard(parsed.value);
  if (guard) return validationError(guard);
  let ids: number[];
  try {
    ids = await runLogged(
      db,
      insertExpenseStatement(db, carId, parsed.value, actorId),
      writeLogStatement(db, {
        agentName: agent,
        action: "expense.create",
        carId,
        entityId: "last_insert",
        before: null,
        after: { carId, ...parsed.value },
      })
    );
  } catch (error) {
    const denied = constraintResponse(error);
    if (denied) return denied;
    throw error;
  }
  const row = await getExpense(db, carId, ids[0]);
  if (!row) return json({ error: "server_error" }, 500);
  return json({ expense: expenseJson(row), writeLogId: ids[1] }, 201);
}

async function patchExpense(
  request: Request,
  db: PortalD1,
  carId: number,
  existing: ExpenseRow,
  agent: string
): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseExpensePatch(body.value);
  if (!parsed.ok) return validationError(parsed.fields);
  const guard = expenseGuard(parsed.value);
  if (guard) return validationError(guard);
  const next = expenseWriteFromRow(existing, parsed.value);
  const before = expenseJson(existing);
  let ids: number[];
  try {
    ids = await runLogged(
      db,
      updateExpenseStatement(db, carId, Number(existing.id), next),
      writeLogStatement(db, {
        agentName: agent,
        action: "expense.update",
        carId,
        entityId: Number(existing.id),
        before,
        after: { ...before, ...next },
      })
    );
  } catch (error) {
    const denied = constraintResponse(error);
    if (denied) return denied;
    throw error;
  }
  const row = await getExpense(db, carId, Number(existing.id));
  if (!row) return notFound();
  return json({ expense: expenseJson(row), writeLogId: ids[1] });
}
