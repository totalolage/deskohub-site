CREATE TABLE "manual_invoice_creation_requests" (
	"invoice_id" text PRIMARY KEY,
	"key_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "manual_invoice_creation_requests_invoice_id_check" CHECK ("invoice_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "manual_invoice_creation_requests_key_id_check" CHECK ("key_id" ~ '^[A-Z][A-Z0-9_]{2,31}$'),
	CONSTRAINT "manual_invoice_creation_requests_digest_check" CHECK ("request_digest" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "manual_invoice_creation_requests_completion_check" CHECK ("completed_at" is null or "completed_at" >= "claimed_at")
);
