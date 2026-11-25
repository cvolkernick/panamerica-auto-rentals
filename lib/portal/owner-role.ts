/**
 * Explicit owner role (migration 0010, docs/manager-role.md "Owner role").
 *
 * Login accounts are `owners` rows. The owner role is derived: an account is an owner when it
 * owns a car, when an admin has granted the role (owners.owner_role = 1), or when it is not a
 * manager. The grant lets an admin make an existing manager-only account an owner without
 * creating a second login. Every read tolerates the column being absent (before 0010).
 */
import type { PortalD1 } from "./d1";
import { isMissingAccountColumn } from "./managers";

export type AccountRoleFlags = { owner: boolean; manager: boolean };

export function isMissingOwnerRoleColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:?\s*(\w+\.)?owner_role/i.test(message);
}

/** owner: owns a car, or granted, or not a manager. */
export function ownerRoleFrom(flags: { ownsCars: boolean; granted: boolean; manager: boolean }): boolean {
  return flags.ownsCars || flags.granted || !flags.manager;
}

export async function grantedOwnerIds(db: PortalD1): Promise<Set<number>> {
  try {
    const result = await db.prepare(`SELECT id FROM owners WHERE owner_role = 1`).bind().all<{ id: number }>();
    return new Set(result.results.map((row) => Number(row.id)));
  } catch (error) {
    if (isMissingOwnerRoleColumn(error)) return new Set();
    throw error;
  }
}

export async function hasGrantedOwnerRole(db: PortalD1, accountId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare(`SELECT owner_role FROM owners WHERE id = ?`)
      .bind(accountId)
      .first<{ owner_role: number | null }>();
    return Number(row?.owner_role ?? 0) === 1;
  } catch (error) {
    if (isMissingOwnerRoleColumn(error)) return false;
    throw error;
  }
}

/** Sets owner_role = 1. Returns "migration_pending" when 0010 is not applied yet. */
export async function grantOwnerRole(db: PortalD1, accountId: number): Promise<"ok" | "not_found" | "migration_pending"> {
  try {
    const result = await db.prepare(`UPDATE owners SET owner_role = 1 WHERE id = ?`).bind(accountId).run();
    return Number(result.meta?.changes ?? 0) === 1 ? "ok" : "not_found";
  } catch (error) {
    if (isMissingOwnerRoleColumn(error)) return "migration_pending";
    throw error;
  }
}

async function managerAccountIds(db: PortalD1): Promise<Set<number>> {
  try {
    const result = await db
      .prepare(`SELECT account_id FROM managers WHERE account_id IS NOT NULL`)
      .bind()
      .all<{ account_id: number }>();
    return new Set(result.results.map((row) => Number(row.account_id)));
  } catch (error) {
    if (isMissingAccountColumn(error)) return new Set();
    throw error;
  }
}

/** Owner and manager flags for every account, for the admin owners list (admin-only JSON). */
export async function accountRoleMap(db: PortalD1): Promise<Map<number, AccountRoleFlags>> {
  const [managers, granted, cars, accounts] = await Promise.all([
    managerAccountIds(db),
    grantedOwnerIds(db),
    db.prepare(`SELECT owner_id, COUNT(*) AS n FROM cars GROUP BY owner_id`).bind().all<{ owner_id: number; n: number }>(),
    db.prepare(`SELECT id FROM owners`).bind().all<{ id: number }>(),
  ]);
  const owning = new Set(cars.results.filter((row) => Number(row.n) > 0).map((row) => Number(row.owner_id)));
  const map = new Map<number, AccountRoleFlags>();
  for (const { id: raw } of accounts.results) {
    const id = Number(raw);
    const manager = managers.has(id);
    map.set(id, { manager, owner: ownerRoleFrom({ ownsCars: owning.has(id), granted: granted.has(id), manager }) });
  }
  return map;
}
