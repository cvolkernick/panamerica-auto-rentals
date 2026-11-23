import { getCarById, getOwnedCar } from "./db";
import type { PortalD1 } from "./d1";
import { validationError, json, readJson } from "./http";
import { currentMonthEastern, monthBounds } from "./ledger";
import {
  assignImportLine,
  carMoneyReport,
  commitTripImport,
  deleteExpense,
  discardImportLine,
  discardTripImport,
  expenseJson,
  getExpense,
  importReviewPayload,
  insertExpense,
  listExpenses,
  listTripImports,
  skipImportLine,
  updateExpense,
  type ExpenseRow,
} from "./money-store";
import { createImportPreview } from "./import/service";
import type { CsvFile, ImportUpload } from "./import/types";
import {
  carStatement,
  deletePayout,
  getPayout,
  insertPayout,
  listPayouts,
  payoutJson,
} from "./statement-store";
import type { CarRow } from "./db";
import {
  parseExpenseCreate,
  parseExpensePatch,
  parseLedgerMonth,
  parsePayoutCreate,
  type ExpenseWrite,
} from "./validate";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { allow });
}

function parsePathId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  return id;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function cleanPlatform(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return text || null;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function csvPart(value: FormDataEntryValue | null): Promise<CsvFile | null | Response> {
  if (value === null) return null;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    if (byteLength(value) > MAX_CSV_BYTES) return json({ error: "file_too_large" }, 413);
    return { filename: "upload.csv", text: value, bytes: byteLength(value) };
  }
  if (value.size === 0) return null;
  if (value.size > MAX_CSV_BYTES) return json({ error: "file_too_large" }, 413);
  const text = decodeUtf8(new Uint8Array(await value.arrayBuffer()));
  if (text === null) return validationError({ file: "The file must be UTF-8 CSV." });
  return { filename: value.name || "upload.csv", text, bytes: value.size };
}

function isResponse(value: CsvFile | null | Response): value is Response {
  return value instanceof Response;
}

async function readImportUpload(
  request: Request
): Promise<{ ok: true; upload: ImportUpload } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_CSV_BYTES) {
    return { ok: false, response: json({ error: "file_too_large" }, 413) };
  }
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const url = new URL(request.url);
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { ok: false, response: validationError({ file: "Could not read that upload." }) };
    }
    const file = await csvPart(form.get("file"));
    if (isResponse(file)) return { ok: false, response: file };
    const reservations = await csvPart(form.get("reservations"));
    if (isResponse(reservations)) return { ok: false, response: reservations };
    const transactions = await csvPart(form.get("transactions"));
    if (isResponse(transactions)) return { ok: false, response: transactions };
    const size = [file, reservations, transactions].reduce((sum, part) => sum + (part?.bytes ?? 0), 0);
    if (size > MAX_CSV_BYTES) return { ok: false, response: json({ error: "file_too_large" }, 413) };
    return {
      ok: true,
      upload: {
        platform: cleanPlatform(form.get("platform")) ?? cleanPlatform(url.searchParams.get("platform")),
        file,
        reservations,
        transactions,
      },
    };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: validationError({ file: "Could not read that upload." }) };
  }
  if (byteLength(text) > MAX_CSV_BYTES) {
    return { ok: false, response: json({ error: "file_too_large" }, 413) };
  }
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, response: json({ error: "invalid_json" }, 400) };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, response: validationError({ body: "Expected an object." }) };
    }
    const record = body as Record<string, unknown>;
    const fileText = typeof record.csv === "string" ? record.csv : null;
    const reservationsText = typeof record.reservations === "string" ? record.reservations : null;
    const transactionsText = typeof record.transactions === "string" ? record.transactions : null;
    return {
      ok: true,
      upload: {
        platform: cleanPlatform(record.platform),
        file: fileText
          ? {
              filename: typeof record.filename === "string" ? record.filename : "upload.csv",
              text: fileText,
              bytes: byteLength(fileText),
            }
          : null,
        reservations: reservationsText
          ? {
              filename:
                typeof record.reservationsFilename === "string"
                  ? record.reservationsFilename
                  : "reservations.csv",
              text: reservationsText,
              bytes: byteLength(reservationsText),
            }
          : null,
        transactions: transactionsText
          ? {
              filename:
                typeof record.transactionsFilename === "string"
                  ? record.transactionsFilename
                  : "transactions.csv",
              text: transactionsText,
              bytes: byteLength(transactionsText),
            }
          : null,
      },
    };
  }
  if (!text.trim()) return { ok: false, response: validationError({ file: "Choose a CSV to import." }) };
  const disposition = request.headers.get("content-disposition");
  const named = disposition ? /filename="?([^";]+)"?/i.exec(disposition)?.[1] : null;
  return {
    ok: true,
    upload: {
      platform: cleanPlatform(url.searchParams.get("platform")),
      file: {
        filename: named || url.searchParams.get("filename") || "upload.csv",
        text,
        bytes: byteLength(text),
      },
      reservations: null,
      transactions: null,
    },
  };
}

function expenseWriteFromRow(row: ExpenseRow, patch: Partial<ExpenseWrite>): ExpenseWrite {
  return {
    entryDate: patch.entryDate ?? row.entry_date,
    category: patch.category ?? row.category,
    amountCents: patch.amountCents ?? Number(row.amount_cents),
    note: patch.note !== undefined ? patch.note : row.note,
  };
}

async function expenseConstraint(error: unknown, db: PortalD1, carId: number): Promise<Response | null> {
  const message = error instanceof Error ? error.message : String(error);
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    return json({ error: "conflict", reason: "foreign_key" }, 409);
  }
  if (/CHECK constraint failed/i.test(message)) {
    return validationError({ body: "That expense is not valid." });
  }
  return null;
}

export async function routeOwnerMoney(
  request: Request,
  db: PortalD1,
  path: string,
  method: string,
  ownerId: number
): Promise<Response | null> {
  const reportMatch = path.match(/^\/api\/portal\/cars\/([1-9]\d*)\/report$/);
  if (reportMatch) {
    if (method !== "GET") return notFound();
    const id = parsePathId(reportMatch[1]);
    if (id === null) return notFound();
    const car = await getOwnedCar(db, id, ownerId);
    if (!car) return notFound();
    return reportResponse(request, db, id);
  }
  const statementMatch = path.match(/^\/api\/portal\/cars\/([1-9]\d*)\/(statement|payouts)$/);
  if (statementMatch) {
    if (method !== "GET") return notFound();
    const id = parsePathId(statementMatch[1]);
    if (id === null) return notFound();
    const car = await getOwnedCar(db, id, ownerId);
    if (!car) return notFound();
    if (statementMatch[2] === "payouts") return payoutListResponse(db, id);
    return statementResponse(request, db, car);
  }
  const expenseMatch = path.match(/^\/api\/portal\/cars\/([1-9]\d*)\/expenses$/);
  if (expenseMatch) {
    if (method !== "GET") return notFound();
    const id = parsePathId(expenseMatch[1]);
    if (id === null) return notFound();
    const car = await getOwnedCar(db, id, ownerId);
    if (!car) return notFound();
    return expenseListResponse(request, db, id);
  }
  return null;
}

async function reportResponse(request: Request, db: PortalD1, carId: number): Promise<Response> {
  const monthRaw = new URL(request.url).searchParams.get("month");
  const month = parseLedgerMonth(monthRaw);
  if (!month.ok) return validationError(month.fields);
  const selected = month.value ?? currentMonthEastern();
  return json(await carMoneyReport(db, carId, selected, monthBounds(selected)));
}

async function statementResponse(request: Request, db: PortalD1, car: CarRow): Promise<Response> {
  const monthRaw = new URL(request.url).searchParams.get("month");
  const month = parseLedgerMonth(monthRaw);
  if (!month.ok) return validationError(month.fields);
  const current = currentMonthEastern();
  return json(await carStatement(db, car, month.value ?? current, current));
}

async function payoutListResponse(db: PortalD1, carId: number): Promise<Response> {
  const rows = await listPayouts(db, carId);
  return json({ payouts: rows.map(payoutJson) });
}

async function expenseListResponse(request: Request, db: PortalD1, carId: number): Promise<Response> {
  const monthRaw = new URL(request.url).searchParams.get("month");
  const month = parseLedgerMonth(monthRaw);
  if (!month.ok) return validationError(month.fields);
  const rows = await listExpenses(db, carId, month.value ? monthBounds(month.value) : undefined);
  return json({ expenses: rows.map(expenseJson), month: month.value });
}

export async function routeAdminMoney(
  request: Request,
  db: PortalD1,
  path: string,
  method: string,
  actorId: number
): Promise<Response | null> {
  if (path === "/api/portal/admin/imports") {
    if (method === "GET") {
      const imports = await listTripImports(db);
      return json({
        imports: imports.map((row) => ({
          id: Number(row.id),
          platform: row.platform,
          filename: row.original_filename,
          rowCount: Number(row.row_count),
          status: row.status,
          createdAt: row.created_at,
          committedAt: row.committed_at,
        })),
      });
    }
    if (method === "POST") {
      const upload = await readImportUpload(request);
      if (!upload.ok) return upload.response;
      const created = await createImportPreview(db, actorId, upload.upload);
      if (!created.ok) {
        if (created.error === "server_error") return json({ error: "server_error" }, created.status);
        return validationError({ file: created.error });
      }
      return json(created.payload, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  const rowAction = path.match(
    /^\/api\/portal\/admin\/imports\/([1-9]\d*)\/rows\/([1-9]\d*)\/(match|skip|discard)$/
  );
  if (rowAction) {
    const importId = parsePathId(rowAction[1]);
    const rowId = parsePathId(rowAction[2]);
    const action = rowAction[3];
    if (importId === null || rowId === null || !action) return notFound();
    if (method !== "POST") return methodNotAllowed("POST");
    if (action === "match") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const carId = carIdFromBody(body.value);
      if (carId === null) return validationError({ carId: "Choose a car." });
      const result = await assignImportLine(db, importId, rowId, carId, actorId);
      if (result === "missing") return notFound();
      if (result === "car") return validationError({ carId: "Car not found." });
      if (result === "closed") return json({ error: "conflict", reason: "import_closed" }, 409);
      const payload = await importReviewPayload(db, importId);
      return payload ? json(payload) : notFound();
    }
    const result =
      action === "skip"
        ? await skipImportLine(db, importId, rowId)
        : await discardImportLine(db, importId, rowId);
    if (result === "missing") return notFound();
    if (result === "closed") return json({ error: "conflict", reason: "import_closed" }, 409);
    if (result === "not_invalid") return json({ error: "conflict", reason: "not_invalid" }, 409);
    const payload = await importReviewPayload(db, importId);
    return payload ? json(payload) : notFound();
  }

  const commitMatch = path.match(/^\/api\/portal\/admin\/imports\/([1-9]\d*)\/commit$/);
  if (commitMatch) {
    if (method !== "POST") return methodNotAllowed("POST");
    const importId = parsePathId(commitMatch[1]);
    if (importId === null) return notFound();
    const result = await commitTripImport(db, importId, actorId);
    if (result === "missing") return notFound();
    if (result === "closed") return json({ error: "conflict", reason: "import_closed" }, 409);
    if (result === "unresolved") return json({ error: "conflict", reason: "unresolved_rows" }, 409);
    if (result === "bad_row") return json({ error: "conflict", reason: "bad_row" }, 409);
    const payload = await importReviewPayload(db, importId);
    return payload ? json(payload) : notFound();
  }

  const discardMatch = path.match(/^\/api\/portal\/admin\/imports\/([1-9]\d*)\/discard$/);
  if (discardMatch) {
    if (method !== "POST") return methodNotAllowed("POST");
    const importId = parsePathId(discardMatch[1]);
    if (importId === null) return notFound();
    const result = await discardTripImport(db, importId);
    if (result === "missing") return notFound();
    if (result === "closed") return json({ error: "conflict", reason: "import_closed" }, 409);
    const payload = await importReviewPayload(db, importId);
    return payload ? json(payload) : notFound();
  }

  const importMatch = path.match(/^\/api\/portal\/admin\/imports\/([1-9]\d*)$/);
  if (importMatch) {
    if (method !== "GET") return methodNotAllowed("GET");
    const importId = parsePathId(importMatch[1]);
    if (importId === null) return notFound();
    const payload = await importReviewPayload(db, importId);
    return payload ? json(payload) : notFound();
  }

  const expenseOne = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/expenses\/([1-9]\d*)$/);
  if (expenseOne) {
    const carId = parsePathId(expenseOne[1]);
    const expenseId = parsePathId(expenseOne[2]);
    if (carId === null || expenseId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    if (method === "PATCH") {
      const existing = await getExpense(db, carId, expenseId);
      if (!existing) return notFound();
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseExpensePatch(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      const next = expenseWriteFromRow(existing, parsed.value);
      try {
        await updateExpense(db, carId, expenseId, next);
      } catch (error) {
        const denied = await expenseConstraint(error, db, carId);
        if (denied) return denied;
        throw error;
      }
      const row = await getExpense(db, carId, expenseId);
      if (!row) return notFound();
      return json({ expense: expenseJson(row) });
    }
    if (method === "DELETE") {
      const existing = await getExpense(db, carId, expenseId);
      if (!existing) return notFound();
      await deleteExpense(db, carId, expenseId);
      return json({ ok: true });
    }
    return methodNotAllowed("PATCH, DELETE");
  }

  const expenseList = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/expenses$/);
  if (expenseList) {
    const carId = parsePathId(expenseList[1]);
    if (carId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    if (method === "GET") return expenseListResponse(request, db, carId);
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseExpenseCreate(body.value);
      if (!parsed.ok) return validationError(parsed.fields);
      let id: number;
      try {
        id = await insertExpense(db, carId, parsed.value, actorId);
      } catch (error) {
        const denied = await expenseConstraint(error, db, carId);
        if (denied) return denied;
        throw error;
      }
      const row = await getExpense(db, carId, id);
      if (!row) return json({ error: "server_error" }, 500);
      return json({ expense: expenseJson(row) }, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  const payoutOne = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/payouts\/([1-9]\d*)$/);
  if (payoutOne) {
    const carId = parsePathId(payoutOne[1]);
    const payoutId = parsePathId(payoutOne[2]);
    if (carId === null || payoutId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    if (method !== "DELETE") return methodNotAllowed("DELETE");
    const existing = await getPayout(db, carId, payoutId);
    if (!existing) return notFound();
    await deletePayout(db, carId, payoutId);
    return json({ ok: true });
  }

  const payoutList = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/payouts$/);
  if (payoutList) {
    const carId = parsePathId(payoutList[1]);
    if (carId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    if (method === "GET") return payoutListResponse(db, carId);
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parsePayoutCreate(body.value, currentMonthEastern());
      if (!parsed.ok) return validationError(parsed.fields);
      let id: number;
      try {
        id = await insertPayout(db, carId, parsed.value, actorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/CHECK constraint failed/i.test(message)) {
          return validationError({ body: "That payout is not valid." });
        }
        if (/FOREIGN KEY constraint failed/i.test(message)) return notFound();
        throw error;
      }
      const row = await getPayout(db, carId, id);
      if (!row) return json({ error: "server_error" }, 500);
      return json({ payout: payoutJson(row) }, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  const statementMatch = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/statement$/);
  if (statementMatch) {
    if (method !== "GET") return methodNotAllowed("GET");
    const carId = parsePathId(statementMatch[1]);
    if (carId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    return statementResponse(request, db, car);
  }

  const reportMatch = path.match(/^\/api\/portal\/admin\/cars\/([1-9]\d*)\/report$/);
  if (reportMatch) {
    if (method !== "GET") return methodNotAllowed("GET");
    const carId = parsePathId(reportMatch[1]);
    if (carId === null) return notFound();
    const car = await getCarById(db, carId);
    if (!car) return notFound();
    return reportResponse(request, db, carId);
  }

  return null;
}

function carIdFromBody(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("carId" in value)) return null;
  const raw = (value as { carId?: unknown }).carId;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^[1-9]\d*$/.test(raw.trim())) {
    const id = Number(raw.trim());
    return Number.isSafeInteger(id) ? id : null;
  }
  return null;
}
