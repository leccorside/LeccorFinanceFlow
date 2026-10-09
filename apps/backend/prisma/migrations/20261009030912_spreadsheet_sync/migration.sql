-- AlterTable
ALTER TABLE "spreadsheets" ADD COLUMN     "sync_started_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "spreadsheet_row_states" (
    "id" UUID NOT NULL,
    "spreadsheet_id" UUID NOT NULL,
    "tab" VARCHAR(30) NOT NULL,
    "record_id" UUID NOT NULL,
    "exported_version" INTEGER NOT NULL,
    "row_hash" CHAR(64) NOT NULL,
    "awaiting_link" BOOLEAN NOT NULL DEFAULT false,
    "conflict_reason" VARCHAR(80),
    "conflict_values" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "spreadsheet_row_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spreadsheet_row_states_spreadsheet_id_tab_idx" ON "spreadsheet_row_states"("spreadsheet_id", "tab");

-- CreateIndex
CREATE UNIQUE INDEX "spreadsheet_row_states_spreadsheet_id_record_id_key" ON "spreadsheet_row_states"("spreadsheet_id", "record_id");

-- AddForeignKey
ALTER TABLE "spreadsheet_row_states" ADD CONSTRAINT "spreadsheet_row_states_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "spreadsheet_row_states"
  ADD CONSTRAINT "spreadsheet_row_states_tab_chk"
    CHECK ("tab" IN ('transactions', 'accounts', 'investments')),
  ADD CONSTRAINT "spreadsheet_row_states_version_chk" CHECK ("exported_version" >= 1),
  ADD CONSTRAINT "spreadsheet_row_states_hash_chk" CHECK ("row_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "spreadsheet_row_states_conflict_chk"
    CHECK (("conflict_reason" IS NULL) = ("conflict_values" IS NULL)),
  ADD CONSTRAINT "spreadsheet_row_states_reason_chk"
    CHECK ("conflict_reason" IS NULL OR "conflict_reason" ~ '^[a-z_:]+$');
