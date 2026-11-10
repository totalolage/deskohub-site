CREATE TABLE "posthog_email_deliveries" (
	"message_id" text PRIMARY KEY,
	"category" text,
	"tags" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"sent_at" timestamp with time zone NOT NULL,
	"status_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "posthog_email_deliveries_status_check" CHECK ("status" in ('queued', 'sent', 'failed', 'delivered', 'bounced', 'complained', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "failure_code" text;--> statement-breakpoint
CREATE INDEX "posthog_email_deliveries_pending_idx" ON "posthog_email_deliveries" ("next_poll_at") WHERE "settled_at" is null;