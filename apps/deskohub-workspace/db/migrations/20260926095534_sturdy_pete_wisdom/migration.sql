CREATE TABLE "customer_communication_preferences" (
	"customer_account_id" text PRIMARY KEY,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_communication_preferences_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ'))
);
--> statement-breakpoint
ALTER TABLE "customer_communication_preferences" ADD CONSTRAINT "customer_communication_preferences_7xsxw1o58AkR_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Deterministic backfill of the required communication-language preference
-- for every existing account. The site default locale (the Inlang base
-- locale, "en-US") is the only stable per-account-independent source: the
-- initiating site language was never recorded historically. Customers can
-- change the preference afterwards. Idempotent by primary key.
INSERT INTO "customer_communication_preferences" ("customer_account_id", "locale")
SELECT u."id", 'en-US' FROM "auth"."user" AS u
ON CONFLICT ("customer_account_id") DO NOTHING;
