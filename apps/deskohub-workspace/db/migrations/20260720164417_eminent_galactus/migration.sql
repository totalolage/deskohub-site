ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_product_tier_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT "workspace_reservations_product_monitor_option_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "reservation_details" jsonb;--> statement-breakpoint
UPDATE "workspace_reservations"
SET "reservation_details" = CASE
	WHEN "product_tier" = 'basic' AND "product_monitor_option" IS NULL
		THEN jsonb_build_object(
			'kind', 'cowork',
			'entryTier', 'basic',
			'coffee', "product_coffee"
		)
	WHEN "product_tier" = 'plus' AND "product_coffee" = true AND "product_monitor_option" IS NULL
		THEN jsonb_build_object(
			'kind', 'cowork',
			'entryTier', 'plus',
			'coffee', true
		)
	WHEN "product_tier" = 'profi' AND "product_coffee" = true AND "product_monitor_option" IS NOT NULL
		THEN jsonb_build_object(
			'kind', 'cowork',
			'entryTier', 'profi',
			'coffee', true,
			'monitorOption', "product_monitor_option"
		)
	ELSE NULL
END;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "reservation_details" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_tier";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_coffee";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN "product_monitor_option";
