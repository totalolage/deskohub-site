CREATE TABLE "late_payment_recoveries" (
	"payment_attempt_id" text PRIMARY KEY,
	"workspace_reservation_id" text NOT NULL,
	"webhook_event_id" text NOT NULL,
	"provider_operation_id" text,
	"provider_status" text,
	"state" text NOT NULL,
	"original_dotypos_reservation_id" text NOT NULL,
	"recovered_dotypos_reservation_id" text,
	"failure_code" text,
	"verified_paid_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_payment_recoveries_state_check" CHECK ("state" in ('pending', 'processing', 'recovered', 'refund_required', 'review_required')),
	CONSTRAINT "late_payment_recoveries_completion_check" CHECK (("state" in ('pending', 'processing') and "completed_at" is null) or ("state" in ('recovered', 'refund_required', 'review_required') and "completed_at" is not null)),
	CONSTRAINT "late_payment_recoveries_recovered_booking_check" CHECK ("state" <> 'recovered' or "recovered_dotypos_reservation_id" is not null),
	CONSTRAINT "late_payment_recoveries_failure_check" CHECK ("state" not in ('refund_required', 'review_required') or ("failure_code" is not null and btrim("failure_code") <> ''))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "late_payment_recoveries_recovered_reservation_unique_idx" ON "late_payment_recoveries" ("recovered_dotypos_reservation_id") WHERE "recovered_dotypos_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "late_payment_recoveries_reservation_idx" ON "late_payment_recoveries" ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "late_payment_recoveries_state_updated_idx" ON "late_payment_recoveries" ("state","updated_at");--> statement-breakpoint
ALTER TABLE "late_payment_recoveries" ADD CONSTRAINT "late_payment_recoveries_wdrCKVWtB7tC_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "late_payment_recoveries" ADD CONSTRAINT "late_payment_recoveries_ChWHYKy6GqHS_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");