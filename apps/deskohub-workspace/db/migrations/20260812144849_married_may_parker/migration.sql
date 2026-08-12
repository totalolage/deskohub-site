CREATE TABLE "invoice_email_deliveries" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"invoice_id" text NOT NULL,
	"audience" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"provider_delivery_id" text,
	"failure_code" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_email_deliveries_audience_check" CHECK ("audience" in ('customer', 'internal')),
	CONSTRAINT "invoice_email_deliveries_state_check" CHECK ("state" in ('processing', 'accepted', 'failed')),
	CONSTRAINT "invoice_email_deliveries_attempt_count_check" CHECK ("attempt_count" > 0),
	CONSTRAINT "invoice_email_deliveries_accepted_check" CHECK ("state" <> 'accepted' or ("provider_delivery_id" is not null and "accepted_at" is not null and "failure_code" is null)),
	CONSTRAINT "invoice_email_deliveries_failed_check" CHECK ("state" <> 'failed' or "failure_code" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_email_deliveries_invoice_audience_unique_idx" ON "invoice_email_deliveries" ("invoice_id","audience");--> statement-breakpoint
CREATE INDEX "invoice_email_deliveries_state_updated_idx" ON "invoice_email_deliveries" ("state","updated_at");--> statement-breakpoint
ALTER TABLE "invoice_email_deliveries" ADD CONSTRAINT "invoice_email_deliveries_invoice_id_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");