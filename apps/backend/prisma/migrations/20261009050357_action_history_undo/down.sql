-- Reverts 20261009050357_action_history_undo:
--   prisma db execute --file prisma/migrations/20261009050357_action_history_undo/down.sql

ALTER TABLE "action_history"
  DROP CONSTRAINT IF EXISTS "action_history_undo_chk",
  DROP CONSTRAINT IF EXISTS "action_history_undo_of_id_fkey";
DROP INDEX IF EXISTS "action_history_batch_id_idx";
ALTER TABLE "action_history"
  DROP COLUMN IF EXISTS "undo_of_id",
  DROP COLUMN IF EXISTS "batch_id";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261009050357_action_history_undo';
