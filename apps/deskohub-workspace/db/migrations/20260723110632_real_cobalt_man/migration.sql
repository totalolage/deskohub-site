ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claim_owner" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claimed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "workspace_reservations"
SET
  "reservation_state" = 'cancellation_failed',
  "failure_code" = coalesce("failure_code", 'cancellation_claim_backfill'),
  "updated_at" = now()
WHERE "reservation_state" = 'cancelling';--> statement-breakpoint
CREATE INDEX "workspace_reservations_cancellation_recovery_idx" ON "workspace_reservations" ("reservation_state","cancellation_claimed_at") WHERE "reservation_state" in ('cancelling', 'cancellation_failed');--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_claim_check" CHECK ((
        "reservation_state" = 'cancelling'
        and "cancellation_claim_owner" is not null
        and "cancellation_claimed_at" is not null
      ) or (
        "reservation_state" <> 'cancelling'
        and "cancellation_claim_owner" is null
        and "cancellation_claimed_at" is null
      ));
