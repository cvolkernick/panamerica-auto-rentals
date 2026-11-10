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
};
