/** Minimal D1 surface the portal uses. Cloudflare's D1Database satisfies this. */
export interface D1RunResult {
  success: boolean;
  meta: {
    last_row_id: number;
    changes: number;
  };
}

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface PortalD1 {
  prepare(query: string): D1Prepared;
}
