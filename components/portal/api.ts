import type { PortalErrorJson } from "@/lib/portal/types";

export type PortalResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: PortalErrorJson | null;
  network: boolean;
};

let csrfToken = "";

export function setPortalCsrf(token: string) {
  csrfToken = token;
}

function rememberCsrf(data: unknown) {
  if (!data || typeof data !== "object" || !("csrfToken" in data)) return;
  const token = (data as { csrfToken?: unknown }).csrfToken;
  if (typeof token === "string") csrfToken = token;
}

export async function portalRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<PortalResult<T>> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { accept: "application/json" };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD" && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = (await response.json().catch(() => null)) as
      | T
      | PortalErrorJson
      | null;
    if (response.status === 401) csrfToken = "";
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: data && typeof data === "object" ? (data as PortalErrorJson) : null,
        network: false,
      };
    }
    rememberCsrf(data);
    return {
      ok: true,
      status: response.status,
      data: data as T,
      error: null,
      network: false,
    };
  } catch {
    return { ok: false, status: 0, data: null, error: null, network: true };
  }
}
