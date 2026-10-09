-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('AI_CHAT', 'VOICE_TRANSCRIPTION', 'VOICE_SPEECH');

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "model" VARCHAR(150) NOT NULL,
    "input_units" INTEGER NOT NULL DEFAULT 0,
    "output_units" INTEGER NOT NULL DEFAULT 0,
    "outcome" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_events_created_at_idx" ON "usage_events"("created_at");

-- CreateIndex
CREATE INDEX "usage_events_kind_provider_model_idx" ON "usage_events"("kind", "provider", "model");

-- Volumes are never negative.
ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_units_chk" CHECK ("input_units" >= 0 AND "output_units" >= 0);
