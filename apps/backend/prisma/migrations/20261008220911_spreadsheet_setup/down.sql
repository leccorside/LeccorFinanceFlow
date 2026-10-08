-- Reverts 20261008220911_spreadsheet_setup:
--   prisma db execute --file prisma/migrations/20261008220911_spreadsheet_setup/down.sql

ALTER TABLE "spreadsheets"
  DROP CONSTRAINT IF EXISTS "spreadsheets_active_has_file_chk",
  DROP CONSTRAINT IF EXISTS "spreadsheets_error_code_chk",
  DROP COLUMN IF EXISTS "locale",
  DROP COLUMN IF EXISTS "setup_started_at",
  DROP COLUMN IF EXISTS "last_error_code";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008220911_spreadsheet_setup';
