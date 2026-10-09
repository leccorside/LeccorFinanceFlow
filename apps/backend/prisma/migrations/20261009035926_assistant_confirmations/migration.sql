-- CreateTable
CREATE TABLE "assistant_confirmations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID,
    "tool_name" VARCHAR(100) NOT NULL,
    "tool_version" SMALLINT NOT NULL,
    "arguments" JSONB NOT NULL,
    "target_fingerprint" CHAR(64) NOT NULL,
    "summary" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_confirmations_owner_id_created_at_idx" ON "assistant_confirmations"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_confirmations_expires_at_idx" ON "assistant_confirmations"("expires_at");

-- AddForeignKey
ALTER TABLE "assistant_confirmations" ADD CONSTRAINT "assistant_confirmations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_confirmations" ADD CONSTRAINT "assistant_confirmations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "assistant_confirmations"
  ADD CONSTRAINT "assistant_confirmations_version_chk" CHECK ("tool_version" >= 1),
  ADD CONSTRAINT "assistant_confirmations_fingerprint_chk"
    CHECK ("target_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "assistant_confirmations_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "assistant_confirmations_final_state_chk"
    CHECK ("used_at" IS NULL OR "canceled_at" IS NULL);

-- Same owner for the conversation it belongs to; owner never changes.
CREATE TRIGGER "assistant_confirmations_owner_check"
  BEFORE INSERT OR UPDATE ON "assistant_confirmations"
  FOR EACH ROW EXECUTE FUNCTION app_check_action_history_owner();
CREATE TRIGGER "assistant_confirmations_owner_immutable"
  BEFORE UPDATE OF "owner_id" ON "assistant_confirmations"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
