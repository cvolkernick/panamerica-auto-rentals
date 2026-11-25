-- Manager accounts, phase 2 prerequisite (docs/manager-role.md).
-- Links a manager row to a portal login account (an owners row). Additive only:
-- one nullable column and one partial unique index. No existing row changes, and
-- no email is invented here: an admin links each phase-1 manager through the API.
-- account_id stays nullable in 0009. A later migration may make it NOT NULL only
-- once every existing row is linked.
--
-- Before apply (production): fresh `d1 export` backup, a D1 Time Travel bookmark,
-- and a read-only check that managers.account_id does not already exist:
--   SELECT COUNT(*) FROM pragma_table_info('managers') WHERE name = 'account_id';
-- Stop if that returns 1. Apply with wrangler d1 execute, never from a deploy step.
-- Rollback: DROP INDEX idx_managers_account_id; ALTER TABLE managers DROP COLUMN account_id;
-- (never drop managers or the other phase-1 tables).
-- Rolling back 0009 alone is safe without reverting the code: sessions and login keep working
-- with no manager role; only manager-admin and the manager view are down until it is re-applied.

PRAGMA foreign_keys = ON;

ALTER TABLE managers ADD COLUMN account_id INTEGER REFERENCES owners (id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_managers_account_id ON managers (account_id) WHERE account_id IS NOT NULL;
