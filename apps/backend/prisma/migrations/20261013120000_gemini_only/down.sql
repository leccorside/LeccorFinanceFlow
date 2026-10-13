-- Reverts 20261013120000_gemini_only:
--   prisma db execute --file prisma/migrations/20261013120000_gemini_only/down.sql
--
-- Restores the three-provider enum and the one-configuration-per-provider-and-purpose key.
-- Deleted OpenAI/Anthropic configurations and keys are NOT restored (run the seed to bring
-- the provider rows back, inactive). Fails if a purpose has several Gemini models: remove
-- the extra ones first.

DROP INDEX "ai_configurations_provider_id_purpose_model_key";
CREATE UNIQUE INDEX "ai_configurations_provider_id_purpose_key"
  ON "ai_configurations"("provider_id", "purpose");

ALTER TYPE "AIProviderType" RENAME TO "AIProviderType_new";
CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'GEMINI', 'ANTHROPIC');
ALTER TABLE "ai_providers"
  ALTER COLUMN "type" TYPE "AIProviderType" USING ("type"::text::"AIProviderType");
ALTER TABLE "conversation_messages"
  ALTER COLUMN "provider" TYPE "AIProviderType" USING ("provider"::text::"AIProviderType");
DROP TYPE "AIProviderType_new";

-- Forget the migration so it can be re-applied.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013120000_gemini_only';
