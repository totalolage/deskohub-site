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
CREATE TABLE "payment_paid_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"payment_attempt_id" text NOT NULL,
	"workspace_reservation_id" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_due_idx" ON "paid_fulfillment_jobs" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_reservation_idx" ON "paid_fulfillment_jobs" ("workspace_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_paid_events_attempt_unique_idx" ON "payment_paid_events" ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "payment_paid_events_reservation_idx" ON "payment_paid_events" ("workspace_reservation_id");--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_Ecnat6TaiDsL_fkey" FOREIGN KEY ("payment_paid_event_id") REFERENCES "payment_paid_events"("id");--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_etoWMNoUJncz_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_payment_attempt_id_payment_attempts_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_giQ5HaGGnRd4_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
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
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_enqueue_paid_event"
AFTER UPDATE OF "payment_state", "active_payment_attempt_id", "paid_at"
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_paid_event_from_reservation"();--> statement-breakpoint
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
$$;--> statement-breakpoint
CREATE TRIGGER "payment_attempts_enqueue_paid_event"
AFTER UPDATE OF "state"
ON "payment_attempts"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_paid_event_from_attempt"();--> statement-breakpoint
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
