-- Reverts 20261009195018_admin_audit_events:
--   prisma db execute --file prisma/migrations/20261009195018_admin_audit_events/down.sql

DROP TABLE IF EXISTS "admin_audit_events";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009195018_admin_audit_events';
