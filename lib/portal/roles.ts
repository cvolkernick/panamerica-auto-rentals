import type { PortalD1 } from "./d1";
import { findManagerRole } from "./managers";
import { hasGrantedOwnerRole, ownerRoleFrom } from "./owner-role";
import type { OwnerJson, SessionRoles } from "./types";

/**
 * Roles for one login account (docs/manager-role.md):
 * - admin: the effective is_admin flag, unchanged by any manager link.
 * - manager: a managers row has account_id = this account.
 * - owner: the account owns at least one car, an admin granted the owner role (owners.owner_role,
 *   migration 0010), or it is not a manager (an owner account that has no cars yet keeps today's
 *   owner view).
 */
export async function accountRoles(db: PortalD1, owner: OwnerJson): Promise<SessionRoles> {
  const [manager, cars, granted] = await Promise.all([
    findManagerRole(db, owner.id),
    db.prepare(`SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?`).bind(owner.id).first<{ n: number }>(),
    hasGrantedOwnerRole(db, owner.id),
  ]);
  const ownsCars = Number(cars?.n ?? 0) > 0;
  return {
    roles: {
      admin: owner.isAdmin,
      owner: ownerRoleFrom({ ownsCars, granted, manager: manager !== null }),
      manager: manager !== null,
    },
    managerId: manager ? Number(manager.id) : null,
  };
}
