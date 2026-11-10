export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex");
  return new Response(JSON.stringify(data), { status, headers });
}

export function unauthorized(reason?: string): Response {
  return json(reason ? { error: "unauthorized", reason } : { error: "unauthorized" }, 401);
}

export function rateLimited(): Response {
  return json({ error: "rate_limited" }, 429);
}

export const INVALID_CREDENTIALS = { error: "invalid_credentials" } as const;

export function forbidden(reason: string, email?: string): Response {
  return json(
    email ? { error: "forbidden", reason, email } : { error: "forbidden", reason },
    403
  );
}

export function validationError(fields: Record<string, string>): Response {
  return json({ error: "validation", fields }, 400);
}

export async function readJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
  if (text.length > 100_000 || !text.trim()) {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}
