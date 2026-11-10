import type { PortalErrorJson } from "@/lib/portal/types";

export type PortalResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: PortalErrorJson | null;
  network: boolean;
};

export async function portalRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<PortalResult<T>> {
  try {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as
      | T
      | PortalErrorJson
      | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: data && typeof data === "object" ? (data as PortalErrorJson) : null,
        network: false,
      };
    }
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
