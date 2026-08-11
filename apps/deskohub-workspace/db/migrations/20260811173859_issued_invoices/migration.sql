ALTER TABLE "accounting_document_snapshots" DROP CONSTRAINT IF EXISTS "accounting_document_snapshots_schema_version_check";--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ALTER COLUMN "schema_version" DROP NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_number_counters" (
	"numbering_year" integer PRIMARY KEY,
	"last_sequence" integer NOT NULL,
	CONSTRAINT "invoice_number_counters_sequence_check" CHECK ("last_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"workspace_reservation_id" text NOT NULL,
	"payment_attempt_id" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"numbering_year" integer NOT NULL,
	"numbering_sequence" integer NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_document" bytea NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoices_dotypos_customer_id_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "invoices_numbering_sequence_check" CHECK ("numbering_sequence" > 0),
	CONSTRAINT "invoices_key_id_check" CHECK ("key_id" ~ '^[A-Z][A-Z0-9_]{2,31}$'),
	CONSTRAINT "invoices_issued_at_year_check" CHECK ("numbering_year" = extract(year from "issued_at" at time zone 'Europe/Prague')::integer)
);
--> statement-breakpoint
ALTER TABLE "invoice_number_counters" DROP CONSTRAINT IF EXISTS "invoice_number_counters_year_check";--> statement-breakpoint
ALTER TABLE "invoice_number_counters" DROP CONSTRAINT IF EXISTS "invoice_number_counters_sequence_check";--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_sequence_check" CHECK ("last_sequence" > 0);--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_numbering_year_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_numbering_sequence_check";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_numbering_sequence_check" CHECK ("numbering_sequence" > 0);--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_number_format_check";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_reservation_unique_idx" ON "invoices" ("workspace_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_payment_attempt_unique_idx" ON "invoices" ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_number_unique_idx" ON "invoices" ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_year_sequence_unique_idx" ON "invoices" ("numbering_year","numbering_sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_dotypos_customer_idx" ON "invoices" ("dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_CKnqj0KDIR8H_fkey";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_dL25hzkNW8DM_fkey";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_CKnqj0KDIR8H_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dL25hzkNW8DM_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "accounting_document_snapshots"("payment_attempt_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_invoice_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM workspace_reservations reservation
		JOIN payment_attempts attempt
			ON attempt.id = NEW.payment_attempt_id
			AND attempt.workspace_reservation_id = reservation.id
		JOIN accounting_document_snapshots snapshot
			ON snapshot.payment_attempt_id = attempt.id
			AND snapshot.workspace_reservation_id = reservation.id
		WHERE reservation.id = NEW.workspace_reservation_id
			AND reservation.payment_state = 'paid'
			AND reservation.active_payment_attempt_id = attempt.id
			AND reservation.dotypos_customer_id = NEW.dotypos_customer_id
			AND attempt.state = 'paid'
	) THEN
		RAISE EXCEPTION 'invoice source must be the active paid attempt and snapshot of the paid reservation'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoices_validate_source ON "invoices";
--> statement-breakpoint
CREATE TRIGGER invoices_validate_source
BEFORE INSERT ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION validate_invoice_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_invoice_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'issued invoices are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoices_immutable ON "invoices";
--> statement-breakpoint
CREATE TRIGGER invoices_immutable
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION reject_invoice_mutation();
