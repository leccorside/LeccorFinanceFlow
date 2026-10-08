-- AlterTable
ALTER TABLE "spreadsheets" ADD COLUMN     "last_error_code" VARCHAR(50),
ADD COLUMN     "locale" "AppLocale" NOT NULL DEFAULT 'pt_BR',
ADD COLUMN     "setup_started_at" TIMESTAMPTZ(3);

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "spreadsheets"
  ADD CONSTRAINT "spreadsheets_active_has_file_chk"
    CHECK ("status" <> 'ACTIVE' OR "google_spreadsheet_id" IS NOT NULL),
  ADD CONSTRAINT "spreadsheets_error_code_chk"
    CHECK ("last_error_code" IS NULL OR "last_error_code" ~ '^[a-z_]+$');
