CREATE TABLE "account_analytics_consent_decisions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"account_id" text NOT NULL,
	"decision" text NOT NULL,
	"document_hash" text NOT NULL,
	"locale" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_analytics_consent_decisions_decision_check" CHECK ("decision" in ('grant', 'withdraw')),
	CONSTRAINT "account_analytics_consent_decisions_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ')),
	CONSTRAINT "account_analytics_consent_decisions_source_check" CHECK ("source" in ('banner', 'sign_in_mirror', 'hydration_mirror', 'backfill', 'preference'))
);
--> statement-breakpoint
CREATE INDEX "account_analytics_consent_decisions_account_decided_idx" ON "account_analytics_consent_decisions" ("account_id","decided_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "account_analytics_consent_decisions" ADD CONSTRAINT "account_analytics_consent_decisions_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;