import type { PortalD1 } from "./d1";

/** Pages project env. PORTAL_DEV_AUTH must stay unset in production. */
export type PortalEnv = {
  DB?: PortalD1;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  PORTAL_DEV_AUTH?: string;
  PORTAL_DEV_EMAIL?: string;
};
