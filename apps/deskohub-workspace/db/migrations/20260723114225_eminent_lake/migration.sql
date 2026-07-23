ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claim_owner" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_failure_disposition" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_retry_at" timestamp with time zone;--> statement-breakpoint
UPDATE "workspace_reservations"
SET
  "cancellation_failure_disposition" = 'retryable',
  "cancellation_retry_at" = now()
WHERE "reservation_state" = 'cancellation_failed';--> statement-breakpoint
CREATE INDEX "workspace_reservations_cancellation_recovery_idx" ON "workspace_reservations" ("reservation_state","cancellation_failure_disposition","cancellation_retry_at","cancellation_claimed_at") WHERE "reservation_state" in ('cancelling', 'cancellation_failed');--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_claim_check" CHECK ((
        "cancellation_claim_owner" is null
        and "cancellation_claimed_at" is null
      ) or (
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
      ));
