ALTER TABLE "cli_authentication_requests" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_approved_by_check" CHECK ("approved_by" is null or char_length(btrim("approved_by")) between 1 and 80);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_reference_check" CHECK (("workspace_reservation_id" is null) = ("payment_attempt_id" is null));--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" DROP CONSTRAINT "cli_authentication_requests_approval_check", ADD CONSTRAINT "cli_authentication_requests_approval_check" CHECK ((
        "approved_at" is null
        and "approved_by" is null
        and "grant_token" is null
        and "grant_expires_at" is null
      ) or (
        "approved_at" is not null
        and "grant_expires_at" is not null
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_invoice_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.workspace_reservation_id IS NULL AND NEW.payment_attempt_id IS NULL THEN
		RETURN NEW;
	END IF;

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
		RAISE EXCEPTION 'invoice source must be manual or the active paid attempt and snapshot of the paid reservation'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
