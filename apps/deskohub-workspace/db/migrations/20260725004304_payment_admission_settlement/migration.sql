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
CREATE UNIQUE INDEX "payment_paid_events_attempt_unique_idx" ON "payment_paid_events" ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "payment_paid_events_reservation_idx" ON "payment_paid_events" ("workspace_reservation_id");--> statement-breakpoint
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
      ));
--> statement-breakpoint
CREATE FUNCTION "enqueue_paid_event_from_reservation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."payment_state" = 'paid'
    AND NEW."active_payment_attempt_id" IS NOT NULL
    AND NEW."paid_at" IS NOT NULL
  THEN
    INSERT INTO "payment_paid_events" (
      "payment_attempt_id",
      "workspace_reservation_id",
      "paid_at"
    )
    SELECT attempt."id", NEW."id", NEW."paid_at"
    FROM "payment_attempts" AS attempt
    WHERE attempt."id" = NEW."active_payment_attempt_id"
      AND attempt."workspace_reservation_id" = NEW."id"
      AND attempt."state" = 'paid'
    ON CONFLICT ("payment_attempt_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_enqueue_paid_event"
AFTER UPDATE OF "payment_state", "active_payment_attempt_id", "paid_at"
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_paid_event_from_reservation"();
--> statement-breakpoint
CREATE FUNCTION "enqueue_paid_event_from_attempt"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" = 'paid' THEN
    INSERT INTO "payment_paid_events" (
      "payment_attempt_id",
      "workspace_reservation_id",
      "paid_at"
    )
    SELECT NEW."id", reservation."id", reservation."paid_at"
    FROM "workspace_reservations" AS reservation
    WHERE reservation."id" = NEW."workspace_reservation_id"
      AND reservation."active_payment_attempt_id" = NEW."id"
      AND reservation."payment_state" = 'paid'
      AND reservation."paid_at" IS NOT NULL
    ON CONFLICT ("payment_attempt_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payment_attempts_enqueue_paid_event"
AFTER UPDATE OF "state"
ON "payment_attempts"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_paid_event_from_attempt"();
--> statement-breakpoint
INSERT INTO "payment_paid_events" (
  "payment_attempt_id",
  "workspace_reservation_id",
  "paid_at"
)
SELECT attempt."id", reservation."id", reservation."paid_at"
FROM "payment_attempts" AS attempt
JOIN "workspace_reservations" AS reservation
  ON reservation."id" = attempt."workspace_reservation_id"
  AND reservation."active_payment_attempt_id" = attempt."id"
WHERE attempt."state" = 'paid'
  AND reservation."payment_state" = 'paid'
  AND reservation."paid_at" IS NOT NULL
ON CONFLICT ("payment_attempt_id") DO NOTHING;
