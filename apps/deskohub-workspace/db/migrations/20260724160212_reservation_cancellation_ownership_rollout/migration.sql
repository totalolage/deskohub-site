ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "cancellation_claim_owner" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "cancellation_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "cancellation_failure_disposition" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "cancellation_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "cancellation_recovery_reason" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_reservation_state_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_reservation_state_check" CHECK ("reservation_state" in ('draft', 'creating_hold', 'held', 'hold_expired', 'confirming', 'confirmed', 'cancelling', 'cancellation_claimed', 'cancelled', 'cancellation_failed'));--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_reservations_stamp_ownerless_cancellation_time" ON "workspace_reservations";--> statement-breakpoint
DROP FUNCTION IF EXISTS "workspace_reservations_stamp_ownerless_cancellation_time"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspace_reservations_handoff_ownerless_cancellation" ON "workspace_reservations";--> statement-breakpoint
DROP FUNCTION IF EXISTS "workspace_reservations_handoff_ownerless_cancellation"();--> statement-breakpoint
UPDATE "workspace_reservations"
SET "reservation_state" = 'cancellation_claimed'
WHERE
  "reservation_state" = 'cancelling'
  AND "cancellation_claim_owner" IS NOT NULL
  AND "cancellation_claimed_at" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION "workspace_reservations_handoff_ownerless_cancellation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW."reservation_state" = 'cancelling'
    AND NEW."cancellation_claim_owner" IS NULL
    AND NEW."cancellation_claimed_at" IS NULL
  THEN
    NEW."reservation_state" = 'cancellation_failed';
    NEW."cancellation_failure_disposition" = 'retryable';
    NEW."cancellation_retry_at" = clock_timestamp();
    NEW."cancellation_recovery_reason" = 'retryable_failure';
    NEW."updated_at" = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_handoff_ownerless_cancellation"
BEFORE INSERT OR UPDATE ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "workspace_reservations_handoff_ownerless_cancellation"();--> statement-breakpoint
UPDATE "workspace_reservations"
SET "updated_at" = clock_timestamp()
WHERE
  "reservation_state" = 'cancelling'
  AND "cancellation_claim_owner" IS NULL
  AND "cancellation_claimed_at" IS NULL;--> statement-breakpoint
UPDATE "workspace_reservations"
SET
  "cancellation_failure_disposition" = 'retryable',
  "cancellation_retry_at" = COALESCE("cancellation_retry_at", now()),
  "cancellation_recovery_reason" = COALESCE("cancellation_recovery_reason", 'retryable_failure')
WHERE "reservation_state" = 'cancellation_failed';--> statement-breakpoint
DROP INDEX IF EXISTS "workspace_reservations_cancellation_recovery_idx";--> statement-breakpoint
CREATE INDEX "workspace_reservations_cancellation_recovery_idx" ON "workspace_reservations" ("reservation_state","cancellation_recovery_reason","cancellation_failure_disposition","cancellation_retry_at","cancellation_claimed_at") WHERE "reservation_state" in ('cancelling', 'cancellation_claimed', 'cancellation_failed');--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_cancellation_claim_check";--> statement-breakpoint
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
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_cancellation_failure_check";--> statement-breakpoint
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
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_cancellation_recovery_reason_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_cancellation_recovery_reason_check" CHECK ("cancellation_recovery_reason" is null or "cancellation_recovery_reason" in ('hold_expired', 'attachment_compensation', 'supersession_recovery', 'retryable_failure', 'stale_claim_recovery'));--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_hold_id_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_hold_id_check" CHECK ("reservation_state" not in ('held', 'confirming', 'confirmed', 'cancelling', 'cancellation_claimed', 'cancelled', 'cancellation_failed') or "dotypos_reservation_id" is not null);
