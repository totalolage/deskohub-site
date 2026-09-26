CREATE TABLE "customer_card_contracts" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"customer_account_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"provider_contract_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"display_circuit" text,
	"display_suffix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_card_contracts_provider_customer_check" CHECK (btrim("provider_customer_id") <> ''),
	CONSTRAINT "customer_card_contracts_provider_contract_check" CHECK (btrim("provider_contract_id") <> ''),
	CONSTRAINT "customer_card_contracts_state_check" CHECK ("state" in ('active', 'removed')),
	CONSTRAINT "customer_card_contracts_display_circuit_check" CHECK ("display_circuit" is null or "display_circuit" ~ '^[A-Z0-9_]{1,20}$'),
	CONSTRAINT "customer_card_contracts_display_suffix_check" CHECK ("display_suffix" is null or "display_suffix" ~ '^[0-9]{1,4}$')
);
--> statement-breakpoint
CREATE TABLE "customer_card_enrollments" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"customer_account_id" text NOT NULL,
	"order_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"provider_contract_id" text NOT NULL,
	"security_token_digest" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_card_enrollments_security_token_digest_check" CHECK ("security_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_card_enrollments_state_check" CHECK ("state" in ('pending', 'confirmed', 'failed', 'cancelled')),
	CONSTRAINT "customer_card_enrollments_failure_code_check" CHECK ("state" not in ('failed', 'cancelled') or btrim("failure_code") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_card_contracts_provider_contract_unique_idx" ON "customer_card_contracts" ("provider_contract_id");--> statement-breakpoint
CREATE INDEX "customer_card_contracts_customer_account_idx" ON "customer_card_contracts" ("customer_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_card_enrollments_order_unique_idx" ON "customer_card_enrollments" ("order_id");--> statement-breakpoint
CREATE INDEX "customer_card_enrollments_customer_account_state_idx" ON "customer_card_enrollments" ("customer_account_id","state");--> statement-breakpoint
ALTER TABLE "customer_card_contracts" ADD CONSTRAINT "customer_card_contracts_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_card_enrollments" ADD CONSTRAINT "customer_card_enrollments_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;