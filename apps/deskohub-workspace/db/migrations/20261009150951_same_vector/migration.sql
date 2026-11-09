ALTER TABLE "payment_attempts" ADD COLUMN "refunded_amount_value" integer;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refund_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "late_payment_recoveries" ALTER COLUMN "webhook_event_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_attempts_refund_required_idx" ON "payment_attempts" ("workspace_reservation_id") WHERE "refund_state" = 'required';--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_refund_record_check" CHECK (("refund_state" = 'refunded' and "refunded_amount_value" > 0 and "refunded_at" is not null) or ("refund_state" <> 'refunded' and "refunded_amount_value" is null and "refunded_at" is null));--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_refund_state_check", ADD CONSTRAINT "payment_attempts_refund_state_check" CHECK ("refund_state" in ('not_required', 'required', 'refunded') and ("refund_state" = 'not_required' or ("provider" = 'nexi' and "state" = 'paid')));