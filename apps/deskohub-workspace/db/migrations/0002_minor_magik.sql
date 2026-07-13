ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_product_tier_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_product_monitor_option_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "reservation_details" jsonb;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'workspace_reservations'
			AND column_name = 'product_tier'
	) THEN
		UPDATE "workspace_reservations"
		SET "reservation_details" = CASE
			WHEN "product_tier" = 'basic' THEN jsonb_build_object('_tag', 'cowork', 'tier', 'basic', 'coffee', "product_coffee")
			WHEN "product_tier" = 'plus' THEN jsonb_build_object('_tag', 'cowork', 'tier', 'plus', 'coffee', true)
			WHEN "product_tier" = 'profi' AND "product_monitor_option" IS NOT NULL THEN jsonb_build_object('_tag', 'cowork', 'tier', 'profi', 'coffee', true, 'monitorOption', "product_monitor_option")
		END
		WHERE "reservation_details" IS NULL;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "workspace_reservations" ALTER COLUMN "reservation_details" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN IF EXISTS "product_tier";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN IF EXISTS "product_coffee";--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN IF EXISTS "product_monitor_option";
