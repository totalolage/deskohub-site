ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_product_tier_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_product_monitor_option_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "reservation_details" jsonb;--> statement-breakpoint
UPDATE "workspace_reservations"
SET "reservation_details" = CASE
	WHEN "product_tier" = 'basic' THEN jsonb_build_object('_tag', 'cowork', 'tier', 'basic', 'coffee', "product_coffee")
	WHEN "product_tier" = 'plus' THEN jsonb_build_object('_tag', 'cowork', 'tier', 'plus', 'coffee', true)
	WHEN "product_tier" = 'profi' THEN jsonb_build_object('_tag', 'cowork', 'tier', 'profi', 'coffee', true, 'monitorOption', "product_monitor_option")
	ELSE jsonb_build_object('_tag', 'meeting-room')
END;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "reservation_details" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_tier";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_coffee";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_monitor_option";
