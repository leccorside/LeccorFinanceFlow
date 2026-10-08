-- Reverts 20261008192955_auth_sessions (drops all sessions and pending logins):
--   prisma db execute --file prisma/migrations/20261008192955_auth_sessions/down.sql
-- The last statement removes the migration record so `prisma migrate deploy` can re-apply it.

DROP TABLE IF EXISTS "auth_login_attempts";
DROP TABLE IF EXISTS "user_sessions";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008192955_auth_sessions';
