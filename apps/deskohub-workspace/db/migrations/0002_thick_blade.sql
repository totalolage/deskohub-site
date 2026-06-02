CREATE TABLE "legal_evidence_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"idempotency_key" text,
	"document_hash" text,
	"accepted" boolean,
	"accepted_at" timestamp with time zone,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_recovery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"reservation_submit_key" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"dotypos_reservation_id" text NOT NULL,
	"attempted_cancellation_result" text,
	"cancellation_attempted_at" timestamp with time zone,
	"failure_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "legal_evidence_audit_idempotency_document_idx" ON "legal_evidence_audit_events" USING btree ("idempotency_key","document_hash");--> statement-breakpoint
CREATE INDEX "legal_evidence_audit_order_idx" ON "legal_evidence_audit_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservation_recovery_order_idx" ON "reservation_recovery_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservation_recovery_submit_key_idx" ON "reservation_recovery_events" USING btree ("reservation_submit_key");--> statement-breakpoint
CREATE INDEX "reservation_recovery_dotypos_reservation_idx" ON "reservation_recovery_events" USING btree ("dotypos_reservation_id");
