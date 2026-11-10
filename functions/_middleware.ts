import { portalApexRedirect } from "../lib/portal/hosts";

type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
};

/**
 * Sends only /owner, /admin, and /api/portal from the apex host to www.
 * Public pages keep whatever routing they already have.
 */
export function onRequest(context: PagesContext): Promise<Response> {
  const redirect = portalApexRedirect(context.request);
  if (redirect) return Promise.resolve(redirect);
  return context.next();
}
