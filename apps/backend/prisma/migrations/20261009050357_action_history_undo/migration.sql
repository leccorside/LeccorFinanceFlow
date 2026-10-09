-- AlterTable
ALTER TABLE "action_history" ADD COLUMN     "batch_id" UUID,
ADD COLUMN     "undo_of_id" UUID;

-- CreateIndex
CREATE INDEX "action_history_batch_id_idx" ON "action_history"("batch_id");

-- AddForeignKey
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_undo_of_id_fkey" FOREIGN KEY ("undo_of_id") REFERENCES "action_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
-- An undo audit row is never itself reversible, and a row is not its own undo.
ALTER TABLE "action_history"
  ADD CONSTRAINT "action_history_undo_chk"
    CHECK ("undo_of_id" IS NULL OR ("is_reversible" = false AND "undo_of_id" <> "id"));
