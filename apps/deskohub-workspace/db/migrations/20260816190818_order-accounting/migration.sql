ALTER TABLE "accounting_document_snapshots" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS accounting_document_snapshots_immutable ON "accounting_document_snapshots";--> statement-breakpoint
DROP TRIGGER IF EXISTS invoices_immutable ON "invoices";--> statement-breakpoint
UPDATE "accounting_document_snapshots" snapshot
SET "order_id" = COALESCE(attempt."order_id", snapshot."workspace_reservation_id")
FROM "payment_attempts" attempt
WHERE attempt."id" = snapshot."payment_attempt_id"
	AND snapshot."order_id" IS NULL
	AND EXISTS (
		SELECT 1 FROM "orders" "order"
		WHERE "order"."id" = COALESCE(attempt."order_id", snapshot."workspace_reservation_id")
	);--> statement-breakpoint
UPDATE "invoices" invoice
SET "order_id" = COALESCE(attempt."order_id", invoice."workspace_reservation_id")
FROM "payment_attempts" attempt
WHERE attempt."id" = invoice."payment_attempt_id"
	AND invoice."order_id" IS NULL
	AND EXISTS (
		SELECT 1 FROM "orders" "order"
		WHERE "order"."id" = COALESCE(attempt."order_id", invoice."workspace_reservation_id")
	);--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_unique_idx" ON "invoices" ("order_id") WHERE "order_id" is not null;--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ADD CONSTRAINT "accounting_document_snapshots_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ADD CONSTRAINT "accounting_document_snapshots_order_reference_check" CHECK ("order_id" is not null or "workspace_reservation_id" is not null);--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ADD CONSTRAINT "accounting_document_snapshots_reservation_order_match_check" CHECK ("workspace_reservation_id" is null or "order_id" is null or "workspace_reservation_id" = "order_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_reference_check" CHECK ("order_id" is not null or "workspace_reservation_id" is not null);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reservation_order_match_check" CHECK ("workspace_reservation_id" is null or "order_id" is null or "workspace_reservation_id" = "order_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_invoice_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM orders "order"
		JOIN payment_attempts attempt
			ON attempt.id = NEW.payment_attempt_id
			AND COALESCE(attempt.order_id, attempt.workspace_reservation_id) = "order".id
		JOIN accounting_document_snapshots snapshot
			ON snapshot.payment_attempt_id = attempt.id
			AND COALESCE(snapshot.order_id, snapshot.workspace_reservation_id) = "order".id
		WHERE "order".id = COALESCE(NEW.order_id, NEW.workspace_reservation_id)
			AND "order".payment_state = 'paid'
			AND "order".active_payment_attempt_id = attempt.id
			AND "order".dotypos_customer_id = NEW.dotypos_customer_id
			AND "order".fulfillment_state = 'fulfilled'
			AND "order".fulfilled_at IS NOT NULL
			AND attempt.state = 'paid'
	) AND NOT EXISTS (
		SELECT 1
		FROM workspace_reservations reservation
		JOIN payment_attempts attempt
			ON attempt.id = NEW.payment_attempt_id
			AND attempt.workspace_reservation_id = reservation.id
		JOIN accounting_document_snapshots snapshot
			ON snapshot.payment_attempt_id = attempt.id
			AND snapshot.workspace_reservation_id = reservation.id
		WHERE NEW.order_id IS NULL
			AND reservation.id = NEW.workspace_reservation_id
			AND reservation.payment_state = 'paid'
			AND reservation.active_payment_attempt_id = attempt.id
			AND reservation.dotypos_customer_id = NEW.dotypos_customer_id
			AND attempt.state = 'paid'
	) THEN
		RAISE EXCEPTION 'invoice source must be the active paid attempt and snapshot of the fulfilled order'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_accounting_document_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'accounting document snapshots are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER accounting_document_snapshots_immutable
BEFORE UPDATE OR DELETE ON "accounting_document_snapshots"
FOR EACH ROW
EXECUTE FUNCTION reject_accounting_document_snapshot_mutation();--> statement-breakpoint
CREATE TRIGGER invoices_immutable
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION reject_invoice_mutation();
