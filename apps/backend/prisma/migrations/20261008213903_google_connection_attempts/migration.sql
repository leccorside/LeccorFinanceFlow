-- CreateEnum
CREATE TYPE "AuthAttemptPurpose" AS ENUM ('LOGIN', 'GOOGLE_CONNECTION');

-- AlterTable
ALTER TABLE "auth_login_attempts" ADD COLUMN     "purpose" "AuthAttemptPurpose" NOT NULL DEFAULT 'LOGIN',
ADD COLUMN     "user_id" UUID;

-- CreateIndex
CREATE INDEX "auth_login_attempts_user_id_idx" ON "auth_login_attempts"("user_id");

-- AddForeignKey
ALTER TABLE "auth_login_attempts" ADD CONSTRAINT "auth_login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "auth_login_attempts"
  ADD CONSTRAINT "auth_login_attempts_purpose_user_chk"
    CHECK (("purpose" = 'GOOGLE_CONNECTION') = ("user_id" IS NOT NULL));

-- Google credentials can only be stored as vault ciphertext ("v<n>.<iv>.<tag>.<data>"),
-- an ACTIVE connection must have a refresh token and inactive ones hold no token at all.
ALTER TABLE "google_connections"
  ADD CONSTRAINT "google_connections_ciphertext_chk"
    CHECK (("access_token_encrypted" IS NULL OR "access_token_encrypted" ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$')
       AND ("refresh_token_encrypted" IS NULL OR "refresh_token_encrypted" ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$')),
  ADD CONSTRAINT "google_connections_status_tokens_chk"
    CHECK (("status" = 'ACTIVE' AND "refresh_token_encrypted" IS NOT NULL)
        OR ("status" <> 'ACTIVE' AND "access_token_encrypted" IS NULL AND "refresh_token_encrypted" IS NULL)),
  ADD CONSTRAINT "google_connections_revoked_chk"
    CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL));
