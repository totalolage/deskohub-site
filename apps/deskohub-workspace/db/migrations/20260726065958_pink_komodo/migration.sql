CREATE TABLE "paid_fulfillment_jobs" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"payment_paid_event_id" text NOT NULL UNIQUE,
	"workspace_reservation_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner_id" text,
	"claimed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paid_fulfillment_jobs_state_check" CHECK ("state" in ('pending', 'processing', 'completed', 'manual')),
	CONSTRAINT "paid_fulfillment_jobs_attempt_count_check" CHECK ("attempt_count" between 0 and 8),
	CONSTRAINT "paid_fulfillment_jobs_lease_check" CHECK ((
        "state" = 'processing'
        and "lease_owner_id" is not null
        and btrim("lease_owner_id") <> ''
        and "claimed_at" is not null
      ) or (
        "state" <> 'processing'
        and "lease_owner_id" is null
        and "claimed_at" is null
      )),
	CONSTRAINT "paid_fulfillment_jobs_completed_check" CHECK (("state" = 'completed' and "completed_at" is not null) or ("state" <> 'completed' and "completed_at" is null)),
	CONSTRAINT "paid_fulfillment_jobs_manual_check" CHECK ("state" <> 'manual' or "failure_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_evidence_conflicts" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"payment_attempt_id" text NOT NULL,
	"conflict_code" text NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_evidence_conflicts_code_check" CHECK ("conflict_code" in ('provider_order_identity', 'provider_amount', 'provider_currency', 'provider_security_token', 'provider_operation_evidence', 'provider_terminal_state'))
);
--> statement-breakpoint
CREATE TABLE "payment_paid_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"payment_attempt_id" text NOT NULL,
	"workspace_reservation_id" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "admission_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "pricing_fingerprint" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "displayed_discount_ids" jsonb;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_start_lease_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_start_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_evidence_conflicted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "active_payment_evidence_conflicted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "payment_reconciliation_attempt_id" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "payment_reconciliation_claim_id" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "payment_reconciliation_claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claim_owner" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_failure_disposition" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_recovery_reason" text;--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_due_idx" ON "paid_fulfillment_jobs" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_reservation_idx" ON "paid_fulfillment_jobs" ("workspace_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_evidence_conflicts_attempt_code_unique_idx" ON "payment_evidence_conflicts" ("payment_attempt_id","conflict_code");--> statement-breakpoint
CREATE INDEX "payment_evidence_conflicts_attempt_idx" ON "payment_evidence_conflicts" ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_paid_events_attempt_unique_idx" ON "payment_paid_events" ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "payment_paid_events_reservation_idx" ON "payment_paid_events" ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "workspace_reservations_cancellation_recovery_idx" ON "workspace_reservations" ("reservation_state","cancellation_recovery_reason","cancellation_failure_disposition","cancellation_retry_at","cancellation_claimed_at") WHERE "reservation_state" in ('cancelling', 'cancellation_claimed', 'cancellation_failed');--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_Ecnat6TaiDsL_fkey" FOREIGN KEY ("payment_paid_event_id") REFERENCES "payment_paid_events"("id");--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_etoWMNoUJncz_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "payment_evidence_conflicts" ADD CONSTRAINT "payment_evidence_conflicts_6dfdhHtTg6gr_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_payment_attempt_id_payment_attempts_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_giQ5HaGGnRd4_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_admission_version_check" CHECK ("admission_version" in (1, 2));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_pricing_identity_check" CHECK ("admission_version" < 2 or (
        "pricing_fingerprint" is not null
        and btrim("pricing_fingerprint") <> ''
        and "displayed_discount_ids" is not null
        and jsonb_typeof("displayed_discount_ids") = 'array'
      ));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_v2_created_lease_check" CHECK ("admission_version" < 2 or "state" <> 'created' or (
        "provider_start_lease_id" is not null
        and "provider_start_lease_expires_at" is not null
      ));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_start_lease_check" CHECK ((
        "provider_start_lease_id" is null
        and "provider_start_lease_expires_at" is null
      ) or (
        "state" = 'created'
        and btrim("provider_start_lease_id") <> ''
        and "provider_start_lease_expires_at" is not null
      ));--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_claim_check" CHECK ((
        "reservation_state" <> 'cancellation_claimed'
        and
        "cancellation_claim_owner" is null
        and "cancellation_claimed_at" is null
      ) or (
        "reservation_state" = 'cancellation_claimed'
        and
        "cancellation_claim_owner" is not null
        and "cancellation_claimed_at" is not null
      ));--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_failure_check" CHECK ((
        "cancellation_failure_disposition" is null
        and "cancellation_retry_at" is null
      ) or (
        "cancellation_failure_disposition" = 'retryable'
        and "cancellation_retry_at" is not null
      ) or (
        "cancellation_failure_disposition" = 'manual_review'
        and "cancellation_retry_at" is null
      ));--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_recovery_reason_check" CHECK ("cancellation_recovery_reason" is null or "cancellation_recovery_reason" in ('hold_expired', 'attachment_compensation', 'supersession_recovery', 'retryable_failure', 'stale_claim_recovery'));--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_payment_reconciliation_claim_check" CHECK (("payment_reconciliation_attempt_id" is null and "payment_reconciliation_claim_id" is null and "payment_reconciliation_claim_expires_at" is null) or ("payment_reconciliation_attempt_id" is not null and "payment_reconciliation_claim_id" is not null and "payment_reconciliation_claim_expires_at" is not null));--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_reservation_state_check", ADD CONSTRAINT "workspace_reservations_reservation_state_check" CHECK ("reservation_state" in ('draft', 'creating_hold', 'held', 'hold_expired', 'confirming', 'confirmed', 'cancelling', 'cancellation_claimed', 'cancelled', 'cancellation_failed'));--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_hold_id_check", ADD CONSTRAINT "workspace_reservations_hold_id_check" CHECK ("reservation_state" not in ('held', 'confirming', 'confirmed', 'cancelling', 'cancellation_claimed', 'cancelled', 'cancellation_failed') or "dotypos_reservation_id" is not null);