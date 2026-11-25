import type { PortalD1 } from "./d1";

/** Pages project env. PORTAL_DEV_AUTH and PORTAL_SETUP_TOKEN stay unset in production docs. */
export type PortalEnv = {
  DB?: PortalD1;
  ADMIN_EMAILS?: string;
  PORTAL_DEV_AUTH?: string;
  PORTAL_DEV_EMAIL?: string;
  /** Operator secret. Unset means the setup route does nothing. */
  PORTAL_SETUP_TOKEN?: string;
  /** HMAC pepper. Unset means login and setup cannot seal a password. */
  PORTAL_PEPPER?: string;
  /** Team connector service token (Bearer). Unset or shorter than 32 chars disables /api/portal/team. */
  PORTAL_TEAM_TOKEN?: string;
  /**
   * Optional read-only team token (Bearer). Authorizes GET routes under /api/portal/team only;
   * any other method gets 403 read_only_token. Unset, empty or shorter than 32 chars never matches.
   * The team API stays disabled unless PORTAL_TEAM_TOKEN is set.
   */
  PORTAL_TEAM_READ_TOKEN?: string;
};
