-- Reverts 20261008213903_google_connection_attempts:
--   prisma db execute --file prisma/migrations/20261008213903_google_connection_attempts/down.sql

ALTER TABLE "google_connections"
  DROP CONSTRAINT IF EXISTS "google_connections_ciphertext_chk",
  DROP CONSTRAINT IF EXISTS "google_connections_status_tokens_chk",
  DROP CONSTRAINT IF EXISTS "google_connections_revoked_chk";

DELETE FROM "auth_login_attempts" WHERE "purpose" = 'GOOGLE_CONNECTION';
ALTER TABLE "auth_login_attempts" DROP CONSTRAINT IF EXISTS "auth_login_attempts_purpose_user_chk";
ALTER TABLE "auth_login_attempts" DROP CONSTRAINT IF EXISTS "auth_login_attempts_user_id_fkey";
DROP INDEX IF EXISTS "auth_login_attempts_user_id_idx";
ALTER TABLE "auth_login_attempts" DROP COLUMN IF EXISTS "user_id", DROP COLUMN IF EXISTS "purpose";
DROP TYPE IF EXISTS "AuthAttemptPurpose";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008213903_google_connection_attempts';
