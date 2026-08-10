CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "accounting_document_snapshots" (
	"payment_attempt_id" text PRIMARY KEY,
	"workspace_reservation_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_snapshot" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_document_snapshots_schema_version_check" CHECK ("schema_version" > 0),
	CONSTRAINT "accounting_document_snapshots_key_id_check" CHECK ("key_id" ~ '^[A-Z][A-Z0-9_]{2,31}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_document_snapshots_reservation_attempt_idx" ON "accounting_document_snapshots" ("workspace_reservation_id","payment_attempt_id");--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ADD CONSTRAINT "accounting_document_snapshots_cDmkhBzQnD2K_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "accounting_document_snapshots" ADD CONSTRAINT "accounting_document_snapshots_Wc9A0G66NEaO_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");
--> statement-breakpoint
CREATE FUNCTION reject_accounting_document_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND EXISTS (
		SELECT 1
		FROM payment_attempts
		WHERE id = OLD.payment_attempt_id
		AND state IN ('failed', 'cancelled', 'expired')
	) THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'accounting document snapshots are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_document_snapshots_immutable
BEFORE UPDATE OR DELETE ON "accounting_document_snapshots"
FOR EACH ROW
EXECUTE FUNCTION reject_accounting_document_snapshot_mutation();
