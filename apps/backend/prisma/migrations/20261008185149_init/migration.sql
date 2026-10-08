-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "AppLocale" AS ENUM ('pt_BR', 'en_US', 'es_ES');

-- CreateEnum
CREATE TYPE "VoiceGender" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "GoogleConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED');

-- CreateEnum
CREATE TYPE "SpreadsheetStatus" AS ENUM ('PENDING_CREATION', 'ACTIVE', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SYNCED', 'PENDING_SYNC', 'CONFLICT');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'WALLET', 'CASH', 'DIGITAL', 'CREDIT_CARD', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE', 'INVESTMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'INVESTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'BANK_SLIP', 'DIRECT_DEBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurrenceIntervalUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "InvestmentClass" AS ENUM ('STOCK', 'REIT', 'ETF', 'CRYPTO', 'TREASURY', 'CDB', 'LCI_LCA', 'FUND', 'PENSION', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'GEMINI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "AIPurpose" AS ENUM ('CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('MONTHLY', 'ANNUAL', 'INCOME', 'EXPENSES', 'CATEGORIES', 'INVESTMENTS', 'ACCOUNTS', 'CASH_FLOW', 'CONSOLIDATED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'XLSX');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActionEntityType" AS ENUM ('TRANSACTION', 'FINANCIAL_ACCOUNT', 'CATEGORY', 'INVESTMENT', 'RECURRING_TRANSACTION', 'INSTALLMENT', 'SPREADSHEET', 'USER_PROFILE', 'VOICE_PREFERENCE');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "google_subject" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "photo_url" VARCHAR(2048),
    "phone" VARCHAR(32),
    "locale" "AppLocale" NOT NULL DEFAULT 'pt_BR',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "voice_preferences" (
    "user_id" UUID NOT NULL,
    "gender" "VoiceGender" NOT NULL DEFAULT 'FEMALE',
    "provider" VARCHAR(50),
    "voice_id" VARCHAR(100),
    "locale" "AppLocale",
    "speaking_rate" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "auto_speak" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "google_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_subject" TEXT NOT NULL,
    "google_email" TEXT NOT NULL,
    "granted_scopes" TEXT[],
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "encryption_key_version" VARCHAR(16),
    "access_token_expires_at" TIMESTAMPTZ(3),
    "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_refreshed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB,
    "encrypted_value" TEXT,
    "encryption_key_version" VARCHAR(16),
    "description" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "spreadsheets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "google_spreadsheet_id" TEXT,
    "name" VARCHAR(150) NOT NULL,
    "status" "SpreadsheetStatus" NOT NULL DEFAULT 'PENDING_CREATION',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "sync_checkpoint" JSONB,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "spreadsheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "institution" VARCHAR(100),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "initial_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(19,4),
    "closing_day" SMALLINT,
    "due_day" SMALLINT,
    "last_four_digits" CHAR(4),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING_SYNC',
    "sync_error" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "system_key" VARCHAR(50),
    "parent_id" UUID,
    "kind" "CategoryKind" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" CHAR(7),
    "icon" VARCHAR(50),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "spreadsheet_id" UUID,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "occurred_on" DATE NOT NULL,
    "due_on" DATE,
    "paid_on" DATE,
    "payment_method" "PaymentMethod",
    "account_id" UUID,
    "transfer_account_id" UUID,
    "category_id" UUID,
    "investment_id" UUID,
    "installment_id" UUID,
    "installment_number" SMALLINT,
    "recurring_transaction_id" UUID,
    "recurrence_occurrence_on" DATE,
    "notes" VARCHAR(1000),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING_SYNC',
    "sync_error" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investments" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "account_id" UUID,
    "asset_class" "InvestmentClass" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "symbol" VARCHAR(30),
    "quantity" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "notes" VARCHAR(1000),
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING_SYNC',
    "sync_error" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_transactions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "spreadsheet_id" UUID,
    "account_id" UUID,
    "category_id" UUID,
    "type" "TransactionType" NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "payment_method" "PaymentMethod",
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval_count" SMALLINT NOT NULL DEFAULT 1,
    "interval_unit" "RecurrenceIntervalUnit",
    "day_of_month" SMALLINT,
    "start_on" DATE NOT NULL,
    "end_on" DATE,
    "next_occurrence_on" DATE NOT NULL,
    "last_materialized_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "spreadsheet_id" UUID,
    "account_id" UUID,
    "category_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "total_amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "installment_count" SMALLINT NOT NULL,
    "purchased_on" DATE NOT NULL,
    "first_due_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "spreadsheet_id" UUID,
    "title" VARCHAR(150),
    "locale" "AppLocale" NOT NULL DEFAULT 'pt_BR',
    "context_summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_name" VARCHAR(100),
    "tool_payload" JSONB,
    "action_history_id" UUID,
    "provider" "AIProviderType",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "type" "AIProviderType" NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" "AIPurpose"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_configurations" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "purpose" "AIPurpose" NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "priority" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "api_key_encrypted" TEXT,
    "encryption_key_version" VARCHAR(16),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "spreadsheet_id" UUID,
    "type" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "file_name" VARCHAR(255),
    "storage_key" VARCHAR(500),
    "error_message" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_history" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID,
    "entity_type" "ActionEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "ActionKind" NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "is_reversible" BOOLEAN NOT NULL DEFAULT true,
    "reverted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_user_id_key" ON "google_connections"("user_id");

-- CreateIndex
CREATE INDEX "google_connections_status_idx" ON "google_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "spreadsheets_google_spreadsheet_id_key" ON "spreadsheets"("google_spreadsheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "spreadsheets_owner_id_name_key" ON "spreadsheets"("owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_owner_id_type_name_key" ON "financial_accounts"("owner_id", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_system_key_key" ON "categories"("system_key");

-- CreateIndex
CREATE INDEX "categories_owner_id_kind_idx" ON "categories"("owner_id", "kind");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "transactions_owner_id_occurred_on_idx" ON "transactions"("owner_id", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_spreadsheet_id_occurred_on_idx" ON "transactions"("spreadsheet_id", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_owner_id_status_due_on_idx" ON "transactions"("owner_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "transactions_owner_id_category_id_occurred_on_idx" ON "transactions"("owner_id", "category_id", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_owner_id_sync_status_idx" ON "transactions"("owner_id", "sync_status");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "transactions_transfer_account_id_idx" ON "transactions"("transfer_account_id");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- CreateIndex
CREATE INDEX "transactions_investment_id_idx" ON "transactions"("investment_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_installment_id_installment_number_key" ON "transactions"("installment_id", "installment_number");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_recurring_transaction_id_recurrence_occurrence_key" ON "transactions"("recurring_transaction_id", "recurrence_occurrence_on");

-- CreateIndex
CREATE INDEX "investments_owner_id_asset_class_idx" ON "investments"("owner_id", "asset_class");

-- CreateIndex
CREATE INDEX "investments_account_id_idx" ON "investments"("account_id");

-- CreateIndex
CREATE INDEX "recurring_transactions_owner_id_is_active_next_occurrence_o_idx" ON "recurring_transactions"("owner_id", "is_active", "next_occurrence_on");

-- CreateIndex
CREATE INDEX "recurring_transactions_spreadsheet_id_idx" ON "recurring_transactions"("spreadsheet_id");

-- CreateIndex
CREATE INDEX "recurring_transactions_account_id_idx" ON "recurring_transactions"("account_id");

-- CreateIndex
CREATE INDEX "recurring_transactions_category_id_idx" ON "recurring_transactions"("category_id");

-- CreateIndex
CREATE INDEX "installments_owner_id_purchased_on_idx" ON "installments"("owner_id", "purchased_on");

-- CreateIndex
CREATE INDEX "installments_spreadsheet_id_idx" ON "installments"("spreadsheet_id");

-- CreateIndex
CREATE INDEX "installments_account_id_idx" ON "installments"("account_id");

-- CreateIndex
CREATE INDEX "installments_category_id_idx" ON "installments"("category_id");

-- CreateIndex
CREATE INDEX "conversations_owner_id_updated_at_idx" ON "conversations"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_spreadsheet_id_idx" ON "conversations"("spreadsheet_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_action_history_id_idx" ON "conversation_messages"("action_history_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_type_key" ON "ai_providers"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ai_configurations_provider_id_purpose_key" ON "ai_configurations"("provider_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "ai_configurations_purpose_priority_key" ON "ai_configurations"("purpose", "priority");

-- CreateIndex
CREATE INDEX "reports_owner_id_created_at_idx" ON "reports"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_status_expires_at_idx" ON "reports"("status", "expires_at");

-- CreateIndex
CREATE INDEX "reports_spreadsheet_id_idx" ON "reports"("spreadsheet_id");

-- CreateIndex
CREATE INDEX "action_history_owner_id_created_at_idx" ON "action_history"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "action_history_entity_type_entity_id_idx" ON "action_history"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "action_history_conversation_id_idx" ON "action_history"("conversation_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_preferences" ADD CONSTRAINT "voice_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spreadsheets" ADD CONSTRAINT "spreadsheets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_fkey" FOREIGN KEY ("transfer_account_id") REFERENCES "financial_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "investments"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_transaction_id_fkey" FOREIGN KEY ("recurring_transaction_id") REFERENCES "recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_action_history_id_fkey" FOREIGN KEY ("action_history_id") REFERENCES "action_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_spreadsheet_id_fkey" FOREIGN KEY ("spreadsheet_id") REFERENCES "spreadsheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- Hand-written section: rules Prisma cannot express in schema.prisma.
-- Keep it in sync with down.sql.
-- ─────────────────────────────────────────────────────────────────────

-- Identity
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_chk" CHECK ("email" = lower(btrim("email")) AND "email" <> '');

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "voice_preferences"
  ADD CONSTRAINT "voice_preferences_speaking_rate_chk" CHECK ("speaking_rate" BETWEEN 0.50 AND 2.00);

ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_one_value_chk"
    CHECK (("value" IS NOT NULL) <> ("encrypted_value" IS NOT NULL)),
  ADD CONSTRAINT "system_settings_key_version_chk"
    CHECK ("encrypted_value" IS NULL OR "encryption_key_version" IS NOT NULL);

ALTER TABLE "google_connections"
  ADD CONSTRAINT "google_connections_key_version_chk"
    CHECK (("access_token_encrypted" IS NULL AND "refresh_token_encrypted" IS NULL)
           OR "encryption_key_version" IS NOT NULL);

-- Finance
ALTER TABLE "spreadsheets"
  ADD CONSTRAINT "spreadsheets_schema_version_chk" CHECK ("schema_version" >= 1);

CREATE UNIQUE INDEX "spreadsheets_one_active_per_owner_key"
  ON "spreadsheets" ("owner_id") WHERE "is_active";

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "financial_accounts_days_chk"
    CHECK (("closing_day" IS NULL OR "closing_day" BETWEEN 1 AND 31)
       AND ("due_day" IS NULL OR "due_day" BETWEEN 1 AND 31)),
  ADD CONSTRAINT "financial_accounts_card_fields_chk"
    CHECK ("type" = 'CREDIT_CARD'
       OR ("credit_limit" IS NULL AND "closing_day" IS NULL AND "due_day" IS NULL
           AND "last_four_digits" IS NULL)),
  ADD CONSTRAINT "financial_accounts_credit_limit_chk" CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0),
  ADD CONSTRAINT "financial_accounts_last_four_chk"
    CHECK ("last_four_digits" IS NULL OR "last_four_digits" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "financial_accounts_version_chk" CHECK ("version" >= 1);

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_system_key_chk" CHECK (("owner_id" IS NULL) = ("system_key" IS NOT NULL)),
  ADD CONSTRAINT "categories_not_own_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "categories_color_chk" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "categories_name_chk" CHECK (btrim("name") <> '');

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "transactions_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "transactions_transfer_chk"
    CHECK (("type" = 'TRANSFER') = ("transfer_account_id" IS NOT NULL)),
  ADD CONSTRAINT "transactions_transfer_accounts_chk"
    CHECK ("transfer_account_id" IS NULL
       OR ("account_id" IS NOT NULL AND "account_id" <> "transfer_account_id")),
  ADD CONSTRAINT "transactions_completed_paid_on_chk"
    CHECK ("status" <> 'COMPLETED' OR "paid_on" IS NOT NULL),
  ADD CONSTRAINT "transactions_installment_chk"
    CHECK (("installment_id" IS NULL) = ("installment_number" IS NULL)
       AND ("installment_number" IS NULL OR "installment_number" >= 1)),
  ADD CONSTRAINT "transactions_description_chk" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "transactions_version_chk" CHECK ("version" >= 1);

ALTER TABLE "investments"
  ADD CONSTRAINT "investments_quantity_chk" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "investments_total_cost_chk" CHECK ("total_cost" >= 0),
  ADD CONSTRAINT "investments_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "investments_version_chk" CHECK ("version" >= 1);

ALTER TABLE "recurring_transactions"
  ADD CONSTRAINT "recurring_transactions_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "recurring_transactions_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "recurring_transactions_interval_chk"
    CHECK ("interval_count" >= 1
       AND (("frequency" = 'CUSTOM') = ("interval_unit" IS NOT NULL))
       AND ("frequency" = 'CUSTOM' OR "interval_count" = 1)),
  ADD CONSTRAINT "recurring_transactions_day_chk"
    CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31),
  ADD CONSTRAINT "recurring_transactions_dates_chk"
    CHECK (("end_on" IS NULL OR "end_on" >= "start_on") AND "next_occurrence_on" >= "start_on"),
  ADD CONSTRAINT "recurring_transactions_version_chk" CHECK ("version" >= 1);

ALTER TABLE "installments"
  ADD CONSTRAINT "installments_total_amount_chk" CHECK ("total_amount" > 0),
  ADD CONSTRAINT "installments_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "installments_count_chk" CHECK ("installment_count" BETWEEN 1 AND 420),
  ADD CONSTRAINT "installments_dates_chk" CHECK ("first_due_on" >= "purchased_on");

-- Conversation, AI and reports
ALTER TABLE "ai_configurations"
  ADD CONSTRAINT "ai_configurations_priority_chk" CHECK ("priority" >= 1),
  ADD CONSTRAINT "ai_configurations_key_version_chk"
    CHECK ("api_key_encrypted" IS NULL OR "encryption_key_version" IS NOT NULL);

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_period_chk" CHECK ("period_end" >= "period_start");

ALTER TABLE "action_history"
  ADD CONSTRAINT "action_history_snapshots_chk"
    CHECK (CASE "action"
             WHEN 'CREATE' THEN "before_state" IS NULL AND "after_state" IS NOT NULL
             WHEN 'UPDATE' THEN "before_state" IS NOT NULL AND "after_state" IS NOT NULL
             WHEN 'DELETE' THEN "before_state" IS NOT NULL AND "after_state" IS NULL
           END);

-- ─────────── Owner isolation (defense in depth below the API layer) ───────────
-- A row may only reference rows of the same owner. Shared rows (owner_id NULL,
-- i.e. system categories) are referenceable by anyone. Missing rows are left to FKs.

CREATE FUNCTION "app_assert_same_owner"(ref_table regclass, ref_id uuid, expected_owner uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actual_owner uuid;
BEGIN
  IF ref_id IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format('SELECT owner_id FROM %s WHERE id = $1', ref_table) INTO actual_owner USING ref_id;
  IF actual_owner IS NOT NULL AND actual_owner IS DISTINCT FROM expected_owner THEN
    RAISE EXCEPTION 'owner mismatch: % % belongs to another owner', ref_table, ref_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "app_prevent_owner_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable on %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_transaction_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_same_owner('spreadsheets', NEW.spreadsheet_id, NEW.owner_id);
  PERFORM app_assert_same_owner('financial_accounts', NEW.account_id, NEW.owner_id);
  PERFORM app_assert_same_owner('financial_accounts', NEW.transfer_account_id, NEW.owner_id);
  PERFORM app_assert_same_owner('categories', NEW.category_id, NEW.owner_id);
  PERFORM app_assert_same_owner('investments', NEW.investment_id, NEW.owner_id);
  PERFORM app_assert_same_owner('installments', NEW.installment_id, NEW.owner_id);
  PERFORM app_assert_same_owner('recurring_transactions', NEW.recurring_transaction_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_planning_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Shared by recurring_transactions and installments (same reference columns).
  PERFORM app_assert_same_owner('spreadsheets', NEW.spreadsheet_id, NEW.owner_id);
  PERFORM app_assert_same_owner('financial_accounts', NEW.account_id, NEW.owner_id);
  PERFORM app_assert_same_owner('categories', NEW.category_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_investment_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_same_owner('financial_accounts', NEW.account_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_category_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_same_owner('categories', NEW.parent_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_spreadsheet_ref_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Shared by conversations and reports.
  PERFORM app_assert_same_owner('spreadsheets', NEW.spreadsheet_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "app_check_action_history_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_same_owner('conversations', NEW.conversation_id, NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_owner_check" BEFORE INSERT OR UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION app_check_transaction_owner();
CREATE TRIGGER "recurring_transactions_owner_check" BEFORE INSERT OR UPDATE ON "recurring_transactions"
  FOR EACH ROW EXECUTE FUNCTION app_check_planning_owner();
CREATE TRIGGER "installments_owner_check" BEFORE INSERT OR UPDATE ON "installments"
  FOR EACH ROW EXECUTE FUNCTION app_check_planning_owner();
CREATE TRIGGER "investments_owner_check" BEFORE INSERT OR UPDATE ON "investments"
  FOR EACH ROW EXECUTE FUNCTION app_check_investment_owner();
CREATE TRIGGER "categories_owner_check" BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION app_check_category_owner();
CREATE TRIGGER "conversations_owner_check" BEFORE INSERT OR UPDATE ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION app_check_spreadsheet_ref_owner();
CREATE TRIGGER "reports_owner_check" BEFORE INSERT OR UPDATE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION app_check_spreadsheet_ref_owner();
CREATE TRIGGER "action_history_owner_check" BEFORE INSERT OR UPDATE ON "action_history"
  FOR EACH ROW EXECUTE FUNCTION app_check_action_history_owner();

CREATE TRIGGER "spreadsheets_owner_immutable" BEFORE UPDATE OF "owner_id" ON "spreadsheets"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "financial_accounts_owner_immutable" BEFORE UPDATE OF "owner_id" ON "financial_accounts"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "categories_owner_immutable" BEFORE UPDATE OF "owner_id" ON "categories"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "transactions_owner_immutable" BEFORE UPDATE OF "owner_id" ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "investments_owner_immutable" BEFORE UPDATE OF "owner_id" ON "investments"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "recurring_transactions_owner_immutable" BEFORE UPDATE OF "owner_id" ON "recurring_transactions"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "installments_owner_immutable" BEFORE UPDATE OF "owner_id" ON "installments"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "conversations_owner_immutable" BEFORE UPDATE OF "owner_id" ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "reports_owner_immutable" BEFORE UPDATE OF "owner_id" ON "reports"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
CREATE TRIGGER "action_history_owner_immutable" BEFORE UPDATE OF "owner_id" ON "action_history"
  FOR EACH ROW EXECUTE FUNCTION app_prevent_owner_change();
