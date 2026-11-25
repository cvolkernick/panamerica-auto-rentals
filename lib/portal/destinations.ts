/**
 * Where a signed-in account can go, and where /sign-in/ sends it.
 *
 * Roles come from GET /api/portal/session (`roles`). Each portal role has one
 * entry below, in priority order. A future role (for example a renter
 * account) is one more entry here plus its flag in the session roles; the
 * sign-in page, the chooser and the in-portal switcher all read this list.
 *
 * Only these fixed same-origin paths are ever used as a destination, so the
 * sign-in page cannot be turned into an open redirect.
 */
export type PortalRoleFlags = Readonly<Record<string, boolean | undefined>>;

export type PortalDestination = {
  role: string;
  href: string;
  label: string;
  description: string;
};

export const PORTAL_DESTINATIONS: readonly PortalDestination[] = [
  { role: "admin", href: "/admin/", label: "Admin", description: "Owners, cars, managers and trip imports." },
  { role: "owner", href: "/owner/", label: "Your cars", description: "Your cars, earnings and statements." },
  { role: "manager", href: "/manager/", label: "Manager view", description: "The cars you manage and your share." },
];

/** The roles a session grants. Older servers send no `roles`: admin flag plus the owner view. */
export function sessionRoleFlags(session: {
  owner?: { isAdmin?: boolean } | null;
  roles?: PortalRoleFlags | null;
}): PortalRoleFlags {
  if (session.roles) return session.roles;
  return { admin: Boolean(session.owner?.isAdmin), owner: true };
}

/** Every portal this account may open, in priority order. */
export function destinationsFor(roles: PortalRoleFlags | null | undefined): PortalDestination[] {
  if (!roles) return [];
  return PORTAL_DESTINATIONS.filter((destination) => roles[destination.role] === true);
}

export type SignInRoute =
  | { kind: "redirect"; href: string }
  | { kind: "choose"; options: PortalDestination[] }
  | { kind: "none" };

/**
 * After sign-in: admins go to /admin/ (it links the other views); an account
 * with one portal goes straight there; an account with several non-admin
 * portals gets a chooser; an account with none sees a plain notice.
 */
export function signInRoute(roles: PortalRoleFlags | null | undefined): SignInRoute {
  const options = destinationsFor(roles);
  if (options.length === 0) return { kind: "none" };
  if (roles?.admin === true) return { kind: "redirect", href: "/admin/" };
  if (options.length === 1) return { kind: "redirect", href: options[0].href };
  return { kind: "choose", options };
}
