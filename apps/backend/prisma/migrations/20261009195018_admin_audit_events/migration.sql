-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "target_user_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events"("created_at");

-- CreateIndex
CREATE INDEX "admin_audit_events_target_user_id_idx" ON "admin_audit_events"("target_user_id");

-- AddForeignKey
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
