CREATE TABLE "email_campaign_audiences" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"title" text NOT NULL,
	"filter" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_audiences_title_check" CHECK (btrim("title") <> '')
);
--> statement-breakpoint
CREATE TABLE "email_campaign_confirmation_codes" (
	"campaign_id" text,
	"code_hash" text,
	"content_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_campaign_confirmation_codes_pkey" PRIMARY KEY("campaign_id","code_hash"),
	CONSTRAINT "email_campaign_confirmation_codes_expiry_check" CHECK ("expires_at" > "issued_at"),
	CONSTRAINT "email_campaign_confirmation_codes_failed_attempts_check" CHECK ("failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_campaign_delivery_batches" (
	"send_id" text,
	"delivery_attempt" integer,
	"batch_index" integer,
	"dotypos_customer_ids" text[] NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "email_campaign_delivery_batches_pkey" PRIMARY KEY("send_id","delivery_attempt","batch_index"),
	CONSTRAINT "email_campaign_delivery_batches_status_check" CHECK ("status" in ('requested', 'accepted', 'rejected', 'unconfirmed')),
	CONSTRAINT "email_campaign_delivery_batches_settled_check" CHECK (("status" = 'requested') = ("settled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_recipients" (
	"send_id" text,
	"dotypos_customer_id" text,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"delivery_attempt" integer DEFAULT 1 NOT NULL,
	"provider_message_id" text,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY("send_id","dotypos_customer_id"),
	CONSTRAINT "email_campaign_recipients_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ')),
	CONSTRAINT "email_campaign_recipients_status_check" CHECK ("status" in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'unconfirmed', 'skipped')),
	CONSTRAINT "email_campaign_recipients_skip_reason_check" CHECK (("status" = 'skipped') = ("skip_reason" is not null) and ("skip_reason" is null or "skip_reason" in ('missing-from-dotypos', 'deleted-customer', 'missing-email', 'invalid-email', 'consent-withdrawn', 'outside-test-domain')))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_sends" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"campaign_id" text NOT NULL,
	"audience_id" text,
	"audience_filter" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"delivery_attempt" integer DEFAULT 1 NOT NULL,
	"delivery_lease_id" text,
	"delivery_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "email_campaign_sends_delivery_attempt_check" CHECK ("delivery_attempt" >= 1),
	CONSTRAINT "email_campaign_sends_delivery_lease_check" CHECK (("delivery_lease_id" is null) = ("delivery_lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"title" text NOT NULL,
	"purpose" text NOT NULL,
	"template_key" text NOT NULL,
	"content" jsonb DEFAULT '{}' NOT NULL,
	"audience_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaigns_title_check" CHECK (btrim("title") <> ''),
	CONSTRAINT "email_campaigns_purpose_check" CHECK ("purpose" in ('marketing', 'operational')),
	CONSTRAINT "email_campaigns_status_check" CHECK ("status" in ('draft', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_confirmation_codes_current_unique_idx" ON "email_campaign_confirmation_codes" ("campaign_id") WHERE "superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_recipients_provider_message_unique_idx" ON "email_campaign_recipients" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_attempt_idx" ON "email_campaign_recipients" ("send_id","delivery_attempt","dotypos_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_sends_campaign_unique_idx" ON "email_campaign_sends" ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_audience_idx" ON "email_campaigns" ("audience_id");--> statement-breakpoint
ALTER TABLE "email_campaign_confirmation_codes" ADD CONSTRAINT "email_campaign_confirmation_codes_XoUpaujzJgyS_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_delivery_batches" ADD CONSTRAINT "email_campaign_delivery_batches_Cu1Bq88TyIQk_fkey" FOREIGN KEY ("send_id") REFERENCES "email_campaign_sends"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_send_id_email_campaign_sends_id_fkey" FOREIGN KEY ("send_id") REFERENCES "email_campaign_sends"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_campaign_id_email_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_PLPsPtsyPxi8_fkey" FOREIGN KEY ("audience_id") REFERENCES "email_campaign_audiences"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_audience_id_email_campaign_audiences_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "email_campaign_audiences"("id") ON DELETE SET NULL;