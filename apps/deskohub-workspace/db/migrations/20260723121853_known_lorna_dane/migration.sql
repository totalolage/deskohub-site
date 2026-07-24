ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claim_owner" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_failure_disposition" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_recovery_reason" text;--> statement-breakpoint
CREATE FUNCTION "workspace_reservations_stamp_ownerless_cancellation_time"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW."reservation_state" = 'cancelling'
    AND NEW."cancellation_claim_owner" IS NULL
    AND NEW."cancellation_claimed_at" IS NULL
  THEN
    NEW."updated_at" = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_stamp_ownerless_cancellation_time"
BEFORE INSERT OR UPDATE ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "workspace_reservations_stamp_ownerless_cancellation_time"();--> statement-breakpoint
UPDATE "workspace_reservations"
SET "updated_at" = clock_timestamp()
WHERE
  "reservation_state" = 'cancelling'
  AND "cancellation_claim_owner" IS NULL
  AND "cancellation_claimed_at" IS NULL;--> statement-breakpoint
UPDATE "workspace_reservations"
SET
  "cancellation_failure_disposition" = 'retryable',
  "cancellation_retry_at" = now(),
  "cancellation_recovery_reason" = 'retryable_failure'
WHERE "reservation_state" = 'cancellation_failed';--> statement-breakpoint
CREATE INDEX "workspace_reservations_cancellation_recovery_idx" ON "workspace_reservations" ("reservation_state","cancellation_recovery_reason","cancellation_failure_disposition","cancellation_retry_at","cancellation_claimed_at") WHERE "reservation_state" in ('cancelling', 'cancellation_failed');--> statement-breakpoint
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
      ));--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_recovery_reason_check" CHECK ("cancellation_recovery_reason" is null or "cancellation_recovery_reason" in ('hold_expired', 'attachment_compensation', 'supersession_recovery', 'retryable_failure', 'stale_claim_recovery'));
