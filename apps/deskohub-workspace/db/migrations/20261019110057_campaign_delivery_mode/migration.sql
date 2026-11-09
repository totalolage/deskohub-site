ALTER TABLE "email_campaigns" ADD COLUMN "delivery" text DEFAULT 'once' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_delivery_check" CHECK ("delivery" in ('once', 'automated'));--> statement-breakpoint
ALTER TABLE "email_campaigns" DROP CONSTRAINT "email_campaigns_status_check", ADD CONSTRAINT "email_campaigns_status_check" CHECK (("delivery" = 'once' and "status" in ('draft', 'sending', 'sent', 'failed')) or ("delivery" = 'automated' and "status" in ('draft', 'active', 'paused', 'archived')));--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_campaign_delivery_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'a campaign''s delivery mode can''t change' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS email_campaigns_delivery_immutable ON "email_campaigns";
--> statement-breakpoint
CREATE TRIGGER email_campaigns_delivery_immutable
BEFORE UPDATE OF delivery ON "email_campaigns"
FOR EACH ROW
WHEN (OLD.delivery IS DISTINCT FROM NEW.delivery)
EXECUTE FUNCTION reject_campaign_delivery_change();
