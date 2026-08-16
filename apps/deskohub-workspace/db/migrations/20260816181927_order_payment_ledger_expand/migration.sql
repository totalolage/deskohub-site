ALTER TABLE "orders" ADD COLUMN "active_payment_attempt_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "workspace_reservations" AS reservation
		INNER JOIN "orders" AS parent ON parent."id" = reservation."id"
		WHERE parent."kind" <> 'reservation'
	)
	THEN
		RAISE EXCEPTION 'reservation id collides with a non-reservation order';
	END IF;
END
$$;--> statement-breakpoint
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
SELECT
	"id",
	'reservation',
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
FROM "workspace_reservations"
ON CONFLICT ("id") DO UPDATE SET
	"correlation_id" = excluded."correlation_id",
	"dotypos_customer_id" = excluded."dotypos_customer_id",
	"payment_state" = excluded."payment_state",
	"fulfillment_state" = excluded."fulfillment_state",
	"active_payment_attempt_id" = excluded."active_payment_attempt_id",
	"paid_at" = excluded."paid_at",
	"fulfilled_at" = excluded."fulfilled_at",
	"fulfillment_failed_at" = excluded."fulfillment_failed_at",
	"fulfillment_failure_code" = excluded."fulfillment_failure_code",
	"created_at" = excluded."created_at",
	"updated_at" = excluded."updated_at"
WHERE "orders"."kind" = 'reservation';--> statement-breakpoint
UPDATE "payment_attempts"
SET "order_id" = "workspace_reservation_id"
WHERE "order_id" IS NULL AND "workspace_reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" ("order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_active_payment_attempt_id_payment_attempts_id_fkey" FOREIGN KEY ("active_payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_reference_check" CHECK ("order_id" is not null or "workspace_reservation_id" is not null);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_reservation_order_match_check" CHECK ("workspace_reservation_id" is null or "order_id" is null or "workspace_reservation_id" = "order_id");
