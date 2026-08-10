DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "discount_product_targets"
		WHERE "product_identity" ->> 'kind' IS NULL
			OR "product_identity" ->> 'kind' NOT IN ('cowork', 'meeting-room', 'office')
	) THEN
		RAISE EXCEPTION 'Cannot migrate an unknown discount product target';
	END IF;
END
$migration$;--> statement-breakpoint
INSERT INTO "discount_product_targets" ("discount_id", "product_identity")
SELECT DISTINCT
	"discount_id",
	jsonb_build_object('kind', "product_identity" ->> 'kind')
FROM "discount_product_targets"
ON CONFLICT ("discount_id", "product_identity") DO NOTHING;--> statement-breakpoint
DELETE FROM "discount_product_targets"
WHERE "product_identity" <> jsonb_build_object(
	'kind',
	"product_identity" ->> 'kind'
);--> statement-breakpoint
ALTER TABLE "discount_product_targets" RENAME COLUMN "product_identity" TO "product_target";
