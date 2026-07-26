ALTER TABLE "workspace_reservations" ADD COLUMN "checkout_session_identity_key" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "checkout_attempt_identity_key" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "checkout_session_compatibility_key" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "checkout_attempt_compatibility_key" text;--> statement-breakpoint
UPDATE "workspace_reservations"
SET
  "checkout_session_identity_key" = "checkout_session_key",
  "checkout_attempt_identity_key" = "checkout_attempt_key",
  "checkout_session_compatibility_key" = "checkout_session_key",
  "checkout_attempt_compatibility_key" = "checkout_attempt_key";--> statement-breakpoint
CREATE FUNCTION "workspace_reservation_checkout_identity_defaults"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."checkout_session_identity_key" :=
    COALESCE(NEW."checkout_session_identity_key", NEW."checkout_session_key");
  NEW."checkout_attempt_identity_key" :=
    COALESCE(NEW."checkout_attempt_identity_key", NEW."checkout_attempt_key");
  NEW."checkout_session_compatibility_key" :=
    COALESCE(NEW."checkout_session_compatibility_key", NEW."checkout_session_key");
  NEW."checkout_attempt_compatibility_key" :=
    COALESCE(NEW."checkout_attempt_compatibility_key", NEW."checkout_attempt_key");
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_reservation_checkout_identity_defaults"
BEFORE INSERT ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "workspace_reservation_checkout_identity_defaults"();--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "checkout_session_identity_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "checkout_attempt_identity_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "checkout_session_compatibility_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "checkout_attempt_compatibility_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_attempt_identity_key_unique_idx" ON "workspace_reservations" ("checkout_attempt_identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_attempt_compatibility_key_unique_idx" ON "workspace_reservations" ("checkout_attempt_compatibility_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_active_session_identity_unique_idx" ON "workspace_reservations" ("checkout_session_identity_key") WHERE "reservation_state" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_active_session_compatibility_unique_idx" ON "workspace_reservations" ("checkout_session_compatibility_key") WHERE "reservation_state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "workspace_reservations_checkout_session_identity_idx" ON "workspace_reservations" ("checkout_session_identity_key","created_at");--> statement-breakpoint
CREATE INDEX "workspace_reservations_checkout_session_compatibility_idx" ON "workspace_reservations" ("checkout_session_compatibility_key","created_at");
