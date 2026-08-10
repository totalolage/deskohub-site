CREATE TABLE "customer_marketing_consents" (
	"dotypos_customer_id" text PRIMARY KEY,
	"document_hash" text NOT NULL,
	"locale" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "customer_marketing_consents_customer_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "customer_marketing_consents_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ')),
	CONSTRAINT "customer_marketing_consents_withdrawal_check" CHECK ("withdrawn_at" is null or "withdrawn_at" >= "granted_at")
);
