ALTER TABLE "customer_accounts" ADD COLUMN "dotypos_customer_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_dotypos_customer_unique_idx" ON "customer_accounts" ("dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_dotypos_customer_check" CHECK (btrim("dotypos_customer_id") <> '');