-- Sessions created before this migration have no CSRF token. Ending them is the
-- safe choice (users simply log in again) and lets the column be NOT NULL.
DELETE FROM "user_sessions";

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "csrf_token" CHAR(43) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section. Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_csrf_token_chk" CHECK ("csrf_token" ~ '^[A-Za-z0-9_-]{43}$');
