-- Reverts 20261009035926_assistant_confirmations:
--   prisma db execute --file prisma/migrations/20261009035926_assistant_confirmations/down.sql

DROP TABLE IF EXISTS "assistant_confirmations";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009035926_assistant_confirmations';
