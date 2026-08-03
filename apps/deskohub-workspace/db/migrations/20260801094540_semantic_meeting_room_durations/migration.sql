DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "discount_product_targets"
		WHERE "product_identity" ->> 'kind' = 'meeting-room'
			AND "product_identity" ? 'durationMinutes'
			AND coalesce("product_identity" ->> 'durationMinutes', '') NOT IN ('60', '240', '1440')
	) OR EXISTS (
		SELECT 1
		FROM "discount_applications"
		WHERE "product_identity" ->> 'kind' = 'meeting-room'
			AND "product_identity" ? 'durationMinutes'
			AND coalesce("product_identity" ->> 'durationMinutes', '') NOT IN ('60', '240', '1440')
	) THEN
		RAISE EXCEPTION
			'Cannot migrate an unknown legacy meeting-room duration';
	END IF;
END
$migration$;--> statement-breakpoint
UPDATE "workspace_reservations"
SET "reservation_details" = jsonb_build_object('kind', 'meeting-room')
WHERE "reservation_details" ->> 'kind' = 'meeting-room';--> statement-breakpoint
INSERT INTO "discount_product_targets" ("discount_id", "product_identity")
SELECT
	"discount_id",
	jsonb_build_object(
		'kind', 'meeting-room',
		'duration', CASE "product_identity" ->> 'durationMinutes'
			WHEN '60' THEN jsonb_build_object('unit', 'hour', 'amount', 1)
			WHEN '240' THEN jsonb_build_object('unit', 'hour', 'amount', 4)
			WHEN '1440' THEN jsonb_build_object('unit', 'day', 'amount', 1)
		END
	)
FROM "discount_product_targets"
WHERE "product_identity" ->> 'kind' = 'meeting-room'
	AND "product_identity" ->> 'durationMinutes' IN ('60', '240', '1440')
ON CONFLICT ("discount_id", "product_identity") DO NOTHING;--> statement-breakpoint
DELETE FROM "discount_product_targets"
WHERE "product_identity" ->> 'kind' = 'meeting-room'
	AND "product_identity" ->> 'durationMinutes' IN ('60', '240', '1440');--> statement-breakpoint
UPDATE "discount_applications"
SET "product_identity" = jsonb_build_object(
	'kind', 'meeting-room',
	'duration', CASE "product_identity" ->> 'durationMinutes'
		WHEN '60' THEN jsonb_build_object('unit', 'hour', 'amount', 1)
		WHEN '240' THEN jsonb_build_object('unit', 'hour', 'amount', 4)
		WHEN '1440' THEN jsonb_build_object('unit', 'day', 'amount', 1)
	END
)
WHERE "product_identity" ->> 'kind' = 'meeting-room'
	AND "product_identity" ->> 'durationMinutes' IN ('60', '240', '1440');
