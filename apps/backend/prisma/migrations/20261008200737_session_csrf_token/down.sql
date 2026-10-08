-- Reverts 20261008200737_session_csrf_token:
--   prisma db execute --file prisma/migrations/20261008200737_session_csrf_token/down.sql

ALTER TABLE "user_sessions" DROP CONSTRAINT IF EXISTS "user_sessions_csrf_token_chk";
ALTER TABLE "user_sessions" DROP COLUMN IF EXISTS "csrf_token";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008200737_session_csrf_token';
