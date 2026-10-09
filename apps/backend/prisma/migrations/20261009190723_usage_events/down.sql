-- Reverts 20261009190723_usage_events:
--   prisma db execute --file prisma/migrations/20261009190723_usage_events/down.sql

DROP TABLE IF EXISTS "usage_events";
DROP TYPE IF EXISTS "UsageKind";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009190723_usage_events';
