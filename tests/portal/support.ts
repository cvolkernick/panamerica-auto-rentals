import type { PortalD1 } from "../../lib/portal/d1";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { createMemoryD1 } from "./memory-d1";

export function requireDb(env: PortalEnv): PortalD1 {
  if (!env.DB) throw new Error("database missing");
  return env.DB;
}

export const PANAMERICA = "panamerica.cars@gmail.com";
export const DEALER = "dealer.partner@example.com";

export function devEnv(email: string, extra: Partial<PortalEnv> = {}): PortalEnv {
  return {
    DB: createMemoryD1(),
    PORTAL_DEV_AUTH: "1",
    PORTAL_DEV_EMAIL: email,
    ...extra,
  };
}

export function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    origin?: string | null;
    host?: string;
    rawBody?: BodyInit;
  } = {}
): Request {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://127.0.0.1");
  const host = options.host ?? "http://127.0.0.1";
  return new Request(`${host}${path}`, {
    method,
    headers,
    body:
      options.rawBody ??
      (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
}

export async function call(
  env: PortalEnv,
  method: string,
  path: string,
  body?: unknown,
  host?: string
) {
  const response = await handlePortal(request(method, path, { body, origin: null, host }), env);
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    text,
  };
}

export async function uploadImport(env: PortalEnv, form: FormData, host?: string) {
  const response = await handlePortal(
    new Request(`${host ?? "http://127.0.0.1"}/api/portal/admin/imports`, {
      method: "POST",
      body: form,
      headers: host ? { origin: host } : { origin: "http://127.0.0.1" },
    }),
    env
  );
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    text,
  };
}

export function csvFile(name: string, text: string): File {
  return new File([text], name, { type: "text/csv" });
}

/**
 * Money counts from each car's ledger start (default 2026-11-01). Tests whose
 * synthetic dates predate that, and that check fee, carry, or share math rather
 * than the start itself, move this car's start earlier.
 */
export async function startLedgerEarly(env: PortalEnv, carId: number, date = "2000-01-01"): Promise<void> {
  await requireDb(env).prepare(`UPDATE cars SET ledger_start_date = ? WHERE id = ?`).bind(date, carId).run();
}
