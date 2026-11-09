SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "active_payment_attempt_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "order_id" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_reservation_order"(reservation "workspace_reservations")
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
	existing record;
BEGIN
	INSERT INTO "orders" (
		"id",
		"kind",
		"correlation_id",
		"dotypos_customer_id",
		"payment_state",
		"fulfillment_state",
		"active_payment_attempt_id",
		"paid_at",
		"fulfilled_at",
		"fulfillment_failed_at",
		"fulfillment_failure_code",
		"created_at",
		"updated_at"
	)
	VALUES (
		reservation."id",
		'reservation',
		reservation."correlation_id",
		reservation."dotypos_customer_id",
		reservation."payment_state",
		reservation."fulfillment_state",
		reservation."active_payment_attempt_id",
		reservation."paid_at",
		reservation."fulfilled_at",
		reservation."fulfillment_failed_at",
		reservation."fulfillment_failure_code",
		reservation."created_at",
		reservation."updated_at"
	)
	ON CONFLICT ("id") DO UPDATE SET
		"dotypos_customer_id" = excluded."dotypos_customer_id",
		"payment_state" = excluded."payment_state",
		"fulfillment_state" = excluded."fulfillment_state",
		"active_payment_attempt_id" = excluded."active_payment_attempt_id",
		"paid_at" = excluded."paid_at",
		"fulfilled_at" = excluded."fulfilled_at",
		"fulfillment_failed_at" = excluded."fulfillment_failed_at",
		"fulfillment_failure_code" = excluded."fulfillment_failure_code",
		"updated_at" = excluded."updated_at"
	WHERE "orders"."kind" = 'reservation'
		AND "orders"."correlation_id" = excluded."correlation_id"
		AND (
			"orders"."dotypos_customer_id",
			"orders"."payment_state",
			"orders"."fulfillment_state",
			"orders"."active_payment_attempt_id",
			"orders"."paid_at",
			"orders"."fulfilled_at",
			"orders"."fulfillment_failed_at",
			"orders"."fulfillment_failure_code"
		) IS DISTINCT FROM (
			excluded."dotypos_customer_id",
			excluded."payment_state",
			excluded."fulfillment_state",
			excluded."active_payment_attempt_id",
			excluded."paid_at",
			excluded."fulfilled_at",
			excluded."fulfillment_failed_at",
			excluded."fulfillment_failure_code"
		);

	-- An unchanged mirror also updates no row, so only the stored order tells
	-- a collision apart. The kind branch guards kinds added after this one.
	IF NOT FOUND THEN
		SELECT "kind", "correlation_id"
		INTO existing
		FROM "orders"
		WHERE "id" = reservation."id";

		IF existing."kind" <> 'reservation'
			OR existing."correlation_id" IS DISTINCT FROM reservation."correlation_id" THEN
			RAISE EXCEPTION 'Order % is not the mirror of the reservation with that ID', reservation."id"
				USING DETAIL = 'The order has another kind or correlation ID.';
		END IF;
	END IF;
END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_reservation_order_on_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	PERFORM "mirror_reservation_order"(NEW);
	RETURN NULL;
END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "remove_reservation_order"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	DELETE FROM "orders"
	WHERE "id" = OLD."id"
		AND "kind" = 'reservation';
	RETURN NULL;
END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "link_payment_attempt_order"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	NEW."order_id" := NEW."workspace_reservation_id";
	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_order_mirror_insert"
AFTER INSERT
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "mirror_reservation_order_on_write"();--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_order_mirror_update"
AFTER UPDATE
ON "workspace_reservations"
FOR EACH ROW
WHEN ((
	OLD."dotypos_customer_id",
	OLD."payment_state",
	OLD."fulfillment_state",
	OLD."active_payment_attempt_id",
	OLD."paid_at",
	OLD."fulfilled_at",
	OLD."fulfillment_failed_at",
	OLD."fulfillment_failure_code"
) IS DISTINCT FROM (
	NEW."dotypos_customer_id",
	NEW."payment_state",
	NEW."fulfillment_state",
	NEW."active_payment_attempt_id",
	NEW."paid_at",
	NEW."fulfilled_at",
	NEW."fulfillment_failed_at",
	NEW."fulfillment_failure_code"
))
EXECUTE FUNCTION "mirror_reservation_order_on_write"();--> statement-breakpoint
CREATE TRIGGER "workspace_reservations_order_mirror_delete"
AFTER DELETE
ON "workspace_reservations"
FOR EACH ROW
EXECUTE FUNCTION "remove_reservation_order"();--> statement-breakpoint
CREATE TRIGGER "payment_attempts_order_link"
BEFORE INSERT
ON "payment_attempts"
FOR EACH ROW
WHEN (NEW."order_id" IS NULL)
EXECUTE FUNCTION "link_payment_attempt_order"();--> statement-breakpoint
-- Set-based backfill: safe only while CREATE TRIGGER above holds SHARE ROW
-- EXCLUSIVE on workspace_reservations. Never rerun it online without that.
SELECT "mirror_reservation_order"(reservation)
FROM "workspace_reservations" AS reservation;--> statement-breakpoint
UPDATE "payment_attempts"
SET "order_id" = "workspace_reservation_id"
WHERE "order_id" IS NULL;--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" ("order_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_reservation_order_match_check" CHECK ("order_id" is null or "order_id" = "workspace_reservation_id");--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
