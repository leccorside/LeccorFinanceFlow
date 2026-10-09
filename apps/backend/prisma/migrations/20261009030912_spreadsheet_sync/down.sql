-- Reverts 20261009030912_spreadsheet_sync:
--   prisma db execute --file prisma/migrations/20261009030912_spreadsheet_sync/down.sql

DROP TABLE IF EXISTS "spreadsheet_row_states";
ALTER TABLE "spreadsheets" DROP COLUMN IF EXISTS "sync_started_at";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009030912_spreadsheet_sync';
