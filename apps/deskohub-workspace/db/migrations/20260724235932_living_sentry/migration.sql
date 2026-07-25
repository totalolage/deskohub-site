DROP INDEX "payment_attempts_provider_order_unique_idx";--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "provider_order_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_nexi_order_unique_idx" ON "payment_attempts" ("provider_order_id") WHERE "provider" = 'nexi';--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_check" CHECK (("provider" = 'nexi' and "amount_value" > 0) or ("provider" = 'internal' and "amount_value" = 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_fields_check" CHECK (("provider" = 'nexi' and "provider_order_id" is not null) or ("provider" = 'internal' and "provider_order_id" is null and "security_token" is null and "provider_redirect_url" is null and "last_webhook_event_id" is null and "last_provider_operation_id" is null and "last_provider_status" is null));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_internal_state_check" CHECK ("provider" <> 'internal' or ("state" = 'paid' and "failure_code" is null));--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_check", ADD CONSTRAINT "payment_attempts_provider_check" CHECK ("provider" in ('nexi', 'internal'));
