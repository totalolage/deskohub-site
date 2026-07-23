CREATE OR REPLACE FUNCTION "workspace_reservations_stamp_ownerless_cancellation_time"()
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
DROP TRIGGER IF EXISTS "workspace_reservations_stamp_ownerless_cancellation_time"
ON "workspace_reservations";--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_stamp_ownerless_cancellation_time"
BEFORE INSERT OR UPDATE ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "workspace_reservations_stamp_ownerless_cancellation_time"();--> statement-breakpoint
UPDATE "workspace_reservations"
SET "updated_at" = clock_timestamp()
WHERE
  "reservation_state" = 'cancelling'
  AND "cancellation_claim_owner" IS NULL
  AND "cancellation_claimed_at" IS NULL;
