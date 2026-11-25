-- Explicit owner role on an existing login account (docs/manager-role.md, "Owner role").
-- An admin can add the owner role to an account that has none yet (for example a
-- manager-only account whose manager buys a car). Additive only: one nullable column.
-- NULL keeps today's derived rule (owns a car, or is not a manager); 1 = granted by an
-- admin. No existing row changes. Code reads this column defensively, so it works
-- before and after this migration.
--
-- Before apply (production): fresh `d1 export` backup, a D1 Time Travel bookmark,
-- and a read-only check that owners.owner_role does not already exist:
--   SELECT COUNT(*) FROM pragma_table_info('owners') WHERE name = 'owner_role';
-- Stop if that returns 1. Apply with wrangler d1 execute, never from a deploy step.
-- Rollback: ALTER TABLE owners DROP COLUMN owner_role;

ALTER TABLE owners ADD COLUMN owner_role INTEGER;
