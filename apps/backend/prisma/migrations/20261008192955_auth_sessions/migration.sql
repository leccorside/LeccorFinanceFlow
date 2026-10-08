-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token_hash" CHAR(64) NOT NULL,
    "access_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "previous_refresh_token_hash" CHAR(64),
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(50),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_login_attempts" (
    "id" UUID NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "code_verifier" VARCHAR(128) NOT NULL,
    "redirect_path" VARCHAR(512) NOT NULL DEFAULT '/',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_access_token_hash_key" ON "user_sessions"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_previous_refresh_token_hash_key" ON "user_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_login_attempts_state_hash_key" ON "auth_login_attempts"("state_hash");

-- CreateIndex
CREATE INDEX "auth_login_attempts_expires_at_idx" ON "auth_login_attempts"("expires_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_hashes_chk"
    CHECK ("access_token_hash" ~ '^[0-9a-f]{64}$'
       AND "refresh_token_hash" ~ '^[0-9a-f]{64}$'
       AND ("previous_refresh_token_hash" IS NULL OR "previous_refresh_token_hash" ~ '^[0-9a-f]{64}$')),
  ADD CONSTRAINT "user_sessions_expiry_chk" CHECK ("refresh_expires_at" >= "access_expires_at"),
  ADD CONSTRAINT "user_sessions_revocation_chk" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL));

ALTER TABLE "auth_login_attempts"
  ADD CONSTRAINT "auth_login_attempts_state_hash_chk" CHECK ("state_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "auth_login_attempts_redirect_chk"
    CHECK ("redirect_path" LIKE '/%' AND "redirect_path" NOT LIKE '//%');
