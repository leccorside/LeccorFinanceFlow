-- Gemini only: OpenAI and Anthropic are no longer supported (2026-10-13).
--
-- 1. Data that refers to the removed providers goes first, so the enum can shrink:
--    their AI configurations (with encrypted keys) are deleted with the provider rows, and
--    the "who answered" mark of old assistant messages is cleared (the text stays).
-- 2. AIProviderType keeps only GEMINI (PostgreSQL cannot drop enum values: swap the type).
-- 3. Several models of the same provider may serve a purpose (fallback between Gemini
--    models): the unique key becomes (provider, purpose, model).
--
-- Anonymous usage_events keep their provider text for the history of costs.

DELETE FROM "ai_providers" WHERE "type" IN ('OPENAI', 'ANTHROPIC');
UPDATE "conversation_messages" SET "provider" = NULL WHERE "provider" IN ('OPENAI', 'ANTHROPIC');

ALTER TYPE "AIProviderType" RENAME TO "AIProviderType_old";
CREATE TYPE "AIProviderType" AS ENUM ('GEMINI');
ALTER TABLE "ai_providers"
  ALTER COLUMN "type" TYPE "AIProviderType" USING ("type"::text::"AIProviderType");
ALTER TABLE "conversation_messages"
  ALTER COLUMN "provider" TYPE "AIProviderType" USING ("provider"::text::"AIProviderType");
DROP TYPE "AIProviderType_old";

DROP INDEX "ai_configurations_provider_id_purpose_key";
CREATE UNIQUE INDEX "ai_configurations_provider_id_purpose_model_key"
  ON "ai_configurations"("provider_id", "purpose", "model");
