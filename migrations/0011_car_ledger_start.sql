-- Per-car ledger start (docs: lib/portal/ledger-start.ts). Panamerica began running
-- cars through the portal in November 2026, so money counts from 2026-11-01.
-- Additive only: one nullable column. NULL means the code default, 2026-11-01, so no
-- existing row changes and no row is backfilled. Trips, expenses, and payouts dated
-- before a car's start stay stored; the report and statement queries skip them.
-- Code reads this column defensively, so it works before and after this migration.
--
-- Before apply (production): fresh `d1 export` backup, a D1 Time Travel bookmark,
-- and a read-only check that cars.ledger_start_date does not already exist:
--   SELECT COUNT(*) FROM pragma_table_info('cars') WHERE name = 'ledger_start_date';
-- Stop if that returns 1. Apply with wrangler d1 execute, never from a deploy step.
-- Rollback: ALTER TABLE cars DROP COLUMN ledger_start_date;

ALTER TABLE cars ADD COLUMN ledger_start_date TEXT CHECK (
  ledger_start_date IS NULL
  OR ledger_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
);
