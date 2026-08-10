ALTER TABLE "discount_product_targets" ADD COLUMN IF NOT EXISTS "product_identity" jsonb;--> statement-breakpoint
ALTER TABLE "discount_product_targets" ADD COLUMN IF NOT EXISTS "product_target" jsonb;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_discount_product_target_columns"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW."product_target" IS NULL THEN
		NEW."product_target" := jsonb_build_object(
			'kind',
			NEW."product_identity" ->> 'kind'
		);
	ELSIF NEW."product_identity" IS NULL THEN
		NEW."product_identity" := CASE NEW."product_target" ->> 'kind'
			WHEN 'cowork' THEN jsonb_build_object(
				'kind', 'cowork',
				'tier', 'basic'
			)
			WHEN 'meeting-room' THEN jsonb_build_object(
				'kind', 'meeting-room',
				'duration', jsonb_build_object('unit', 'hour', 'amount', 1)
			)
			WHEN 'office' THEN jsonb_build_object(
				'kind', 'office',
				'seats', 1,
				'dayCount', 1
			)
		END;
	ELSIF TG_OP = 'UPDATE' THEN
		IF NEW."product_identity" IS DISTINCT FROM OLD."product_identity"
			AND NEW."product_target" IS NOT DISTINCT FROM OLD."product_target" THEN
			NEW."product_target" := jsonb_build_object(
				'kind',
				NEW."product_identity" ->> 'kind'
			);
		ELSIF OLD."product_target" IS NOT NULL
			AND NEW."product_target" IS DISTINCT FROM OLD."product_target"
			AND NEW."product_identity" IS NOT DISTINCT FROM OLD."product_identity" THEN
			NEW."product_identity" := CASE NEW."product_target" ->> 'kind'
				WHEN 'cowork' THEN jsonb_build_object(
					'kind', 'cowork',
					'tier', 'basic'
				)
				WHEN 'meeting-room' THEN jsonb_build_object(
					'kind', 'meeting-room',
					'duration', jsonb_build_object('unit', 'hour', 'amount', 1)
				)
				WHEN 'office' THEN jsonb_build_object(
					'kind', 'office',
					'seats', 1,
					'dayCount', 1
				)
			END;
		END IF;
	END IF;

	IF NEW."product_identity" ->> 'kind' IS DISTINCT FROM NEW."product_target" ->> 'kind' THEN
		RAISE EXCEPTION 'Discount product identity and target kinds must match';
	END IF;

	RETURN NEW;
END
$function$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "discount_product_targets_sync_columns" ON "discount_product_targets";--> statement-breakpoint
CREATE TRIGGER "discount_product_targets_sync_columns"
BEFORE INSERT OR UPDATE OF "product_identity", "product_target"
ON "discount_product_targets"
FOR EACH ROW
EXECUTE FUNCTION "sync_discount_product_target_columns"();--> statement-breakpoint
ALTER TABLE "discount_product_targets" DROP CONSTRAINT IF EXISTS "discount_product_targets_pk";--> statement-breakpoint
INSERT INTO "discount_product_targets" (
	"discount_id",
	"product_identity",
	"product_target"
)
SELECT
	legacy."discount_id",
	identity."product_identity",
	legacy."product_target"
FROM "discount_product_targets" AS legacy
CROSS JOIN (
	VALUES
		(jsonb_build_object('kind', 'cowork', 'tier', 'plus')),
		(jsonb_build_object('kind', 'cowork', 'tier', 'profi'))
) AS identity("product_identity")
WHERE legacy."product_identity" IS NULL
	AND legacy."product_target" ->> 'kind' = 'cowork';--> statement-breakpoint
INSERT INTO "discount_product_targets" (
	"discount_id",
	"product_identity",
	"product_target"
)
SELECT
	legacy."discount_id",
	identity."product_identity",
	legacy."product_target"
FROM "discount_product_targets" AS legacy
CROSS JOIN (
	VALUES
		(jsonb_build_object(
			'kind', 'meeting-room',
			'duration', jsonb_build_object('unit', 'hour', 'amount', 4)
		)),
		(jsonb_build_object(
			'kind', 'meeting-room',
			'duration', jsonb_build_object('unit', 'day', 'amount', 1)
		))
) AS identity("product_identity")
WHERE legacy."product_identity" IS NULL
	AND legacy."product_target" ->> 'kind' = 'meeting-room';--> statement-breakpoint
UPDATE "discount_product_targets"
SET "product_identity" = CASE "product_target" ->> 'kind'
	WHEN 'cowork' THEN jsonb_build_object(
		'kind', 'cowork',
		'tier', 'basic'
	)
	WHEN 'meeting-room' THEN jsonb_build_object(
		'kind', 'meeting-room',
		'duration', jsonb_build_object('unit', 'hour', 'amount', 1)
	)
	WHEN 'office' THEN jsonb_build_object(
		'kind', 'office',
		'seats', 1,
		'dayCount', 1
	)
END
WHERE "product_identity" IS NULL;--> statement-breakpoint
UPDATE "discount_product_targets"
SET "product_target" = jsonb_build_object(
	'kind',
	"product_identity" ->> 'kind'
)
WHERE "product_target" IS NULL;--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "discount_product_targets"
		WHERE "product_identity" ->> 'kind' IS NULL
			OR "product_identity" ->> 'kind' NOT IN ('cowork', 'meeting-room', 'office')
			OR "product_target" <> jsonb_build_object(
				'kind',
				"product_identity" ->> 'kind'
			)
	) THEN
		RAISE EXCEPTION 'Cannot migrate an unknown discount product target';
	END IF;
END
$migration$;--> statement-breakpoint
DELETE FROM "discount_product_targets" AS duplicate
USING "discount_product_targets" AS retained
WHERE duplicate."discount_id" = retained."discount_id"
	AND duplicate."product_identity" = retained."product_identity"
	AND duplicate.ctid > retained.ctid;--> statement-breakpoint
ALTER TABLE "discount_product_targets" ALTER COLUMN "product_identity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_product_targets" ALTER COLUMN "product_target" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_product_targets" ADD CONSTRAINT "discount_product_targets_pk" PRIMARY KEY("discount_id", "product_identity");
