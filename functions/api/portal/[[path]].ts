import { handlePortal } from "../../../lib/portal/handler";
import type { PortalEnv } from "../../../lib/portal/env";

/**
 * Cloudflare Pages Function for /api/portal and /api/portal/*.
 * Static pages stay in the Next export. This file is not part of that export.
 */
export function onRequest(context: {
  request: Request;
  env: PortalEnv;
}): Promise<Response> {
  return handlePortal(context.request, context.env);
}
