CREATE TABLE "payment_paid_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"payment_attempt_id" text NOT NULL,
	"workspace_reservation_id" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "payment_attempts" ADD COLUMN "admission_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "pricing_fingerprint" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "displayed_discount_ids" jsonb;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_start_lease_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_start_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_evidence_conflicted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "active_payment_evidence_conflicted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_paid_events_attempt_unique_idx" ON "payment_paid_events" ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "payment_paid_events_reservation_idx" ON "payment_paid_events" ("workspace_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_evidence_conflicts_attempt_code_unique_idx" ON "payment_evidence_conflicts" ("payment_attempt_id","conflict_code");--> statement-breakpoint
CREATE INDEX "payment_evidence_conflicts_attempt_idx" ON "payment_evidence_conflicts" ("payment_attempt_id");--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_payment_attempt_id_payment_attempts_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "payment_paid_events" ADD CONSTRAINT "payment_paid_events_giQ5HaGGnRd4_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "payment_evidence_conflicts" ADD CONSTRAINT "payment_evidence_conflicts_6dfdhHtTg6gr_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE CASCADE;--> statement-breakpoint
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
CREATE FUNCTION "guard_unverified_v2_terminal_settlement"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."admission_version" = 2
    AND OLD."state" IN ('created', 'pending')
    AND NEW."state" IN ('failed', 'cancelled', 'expired')
    AND current_setting(
      'deskohub.verified_v2_terminal_settlement',
      true
    ) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION
      'active v2 payment cannot be terminalized without verified settlement'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payment_attempts_guard_unverified_v2_terminal"
BEFORE UPDATE OF "state"
ON "payment_attempts"
FOR EACH ROW
EXECUTE FUNCTION "guard_unverified_v2_terminal_settlement"();
--> statement-breakpoint
CREATE FUNCTION "materialize_payment_evidence_conflict"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "payment_attempts"
  SET "provider_evidence_conflicted" = true
  WHERE "id" = NEW."payment_attempt_id";

  UPDATE "workspace_reservations"
  SET "active_payment_evidence_conflicted" = true
  WHERE "active_payment_attempt_id" = NEW."payment_attempt_id";

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payment_evidence_conflicts_materialize"
AFTER INSERT
ON "payment_evidence_conflicts"
FOR EACH ROW
EXECUTE FUNCTION "materialize_payment_evidence_conflict"();
--> statement-breakpoint
CREATE FUNCTION "guard_provider_evidence_conflicted_attempt"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."provider_evidence_conflicted"
    AND NOT NEW."provider_evidence_conflicted"
  THEN
    RAISE EXCEPTION
      'provider evidence conflict cannot be cleared in place'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."provider_evidence_conflicted"
    AND OLD."state" IS DISTINCT FROM NEW."state"
    AND NEW."state" IN ('paid', 'failed', 'cancelled', 'expired')
  THEN
    RAISE EXCEPTION
      'provider evidence conflict requires manual review before settlement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payment_attempts_guard_provider_evidence_conflict"
BEFORE UPDATE OF "state", "provider_evidence_conflicted"
ON "payment_attempts"
FOR EACH ROW
EXECUTE FUNCTION "guard_provider_evidence_conflicted_attempt"();
--> statement-breakpoint
CREATE FUNCTION "reject_provider_evidence_conflicted_attempt_settlement"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD."provider_evidence_conflicted" OR NEW."provider_evidence_conflicted")
    AND NEW."state" IN ('paid', 'failed', 'cancelled', 'expired')
  THEN
    RAISE EXCEPTION
      'provider evidence conflict rejects attempt settlement replay'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payment_attempts_reject_provider_evidence_conflicted_settlement"
BEFORE UPDATE OF "state"
ON "payment_attempts"
FOR EACH ROW
EXECUTE FUNCTION "reject_provider_evidence_conflicted_attempt_settlement"();
--> statement-breakpoint
CREATE FUNCTION "guard_unverified_v2_reservation_terminal"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."active_payment_attempt_id" IS DISTINCT FROM OLD."active_payment_attempt_id"
  THEN
    IF OLD."active_payment_attempt_id" IS NOT NULL
      AND (
        OLD."active_payment_evidence_conflicted"
        OR EXISTS (
          SELECT 1
          FROM "payment_evidence_conflicts" AS conflict
          WHERE conflict."payment_attempt_id" = OLD."active_payment_attempt_id"
        )
      )
    THEN
      RAISE EXCEPTION
        'provider evidence conflict rejects active attempt replacement'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(attempt."provider_evidence_conflicted", false)
    INTO NEW."active_payment_evidence_conflicted"
    FROM (SELECT 1) AS singleton
    LEFT JOIN "payment_attempts" AS attempt
      ON attempt."id" = NEW."active_payment_attempt_id"
      AND attempt."workspace_reservation_id" = NEW."id";
  ELSIF OLD."active_payment_evidence_conflicted" THEN
    NEW."active_payment_evidence_conflicted" := true;
  END IF;

  IF NEW."active_payment_evidence_conflicted"
    AND OLD."payment_state" IS DISTINCT FROM NEW."payment_state"
    AND NEW."payment_state" IN ('paid', 'failed', 'cancelled', 'expired')
  THEN
    RAISE EXCEPTION
      'provider evidence conflict requires manual review before reservation settlement'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."payment_state" = 'pending'
    AND NEW."payment_state" IN ('failed', 'cancelled', 'expired')
    AND current_setting(
      'deskohub.verified_v2_terminal_settlement',
      true
    ) IS DISTINCT FROM 'on'
    AND EXISTS (
      SELECT 1
      FROM "payment_attempts" AS attempt
      WHERE attempt."id" = OLD."active_payment_attempt_id"
        AND attempt."workspace_reservation_id" = OLD."id"
        AND attempt."admission_version" = 2
        AND attempt."state" IN ('created', 'pending')
    )
  THEN
    RAISE EXCEPTION
      'reservation with active v2 payment cannot be terminalized without verified settlement'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."reservation_state" IS DISTINCT FROM NEW."reservation_state"
    AND NEW."reservation_state" IN (
      'hold_expired',
      'cancelling',
      'cancelled'
    )
    AND EXISTS (
      SELECT 1
      FROM "payment_attempts" AS attempt
      WHERE attempt."id" = OLD."active_payment_attempt_id"
        AND attempt."workspace_reservation_id" = OLD."id"
        AND attempt."admission_version" = 2
        AND attempt."state" IN ('created', 'pending')
    )
  THEN
    RAISE EXCEPTION
      'reservation with active v2 payment cannot enter cleanup cancellation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_guard_unverified_v2_terminal"
BEFORE UPDATE OF "payment_state", "reservation_state", "active_payment_attempt_id", "active_payment_evidence_conflicted"
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "guard_unverified_v2_reservation_terminal"();
--> statement-breakpoint
CREATE FUNCTION "reject_provider_evidence_conflicted_reservation_settlement"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."payment_state" IN ('paid', 'failed', 'cancelled', 'expired')
    AND (
      OLD."active_payment_evidence_conflicted"
      OR NEW."active_payment_evidence_conflicted"
      OR EXISTS (
        SELECT 1
        FROM "payment_attempts" AS attempt
        WHERE attempt."id" = NEW."active_payment_attempt_id"
          AND attempt."workspace_reservation_id" = NEW."id"
          AND attempt."provider_evidence_conflicted"
      )
    )
  THEN
    RAISE EXCEPTION
      'provider evidence conflict rejects reservation settlement replay'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_reject_provider_evidence_conflicted_settlement"
BEFORE UPDATE OF "payment_state"
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "reject_provider_evidence_conflicted_reservation_settlement"();
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
