CREATE TABLE "discount_targets" (
	"discount_id" text,
	"product_target" jsonb,
	CONSTRAINT "discount_product_targets_pk" PRIMARY KEY("discount_id","product_target")
);
--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "discount_product_targets"
		WHERE "product_identity" ->> 'kind' IS NULL
			OR "product_identity" ->> 'kind' NOT IN ('cowork', 'meeting-room', 'office')
	) THEN
		RAISE EXCEPTION 'Cannot migrate an unknown discount product identity';
	END IF;
END
$migration$;--> statement-breakpoint
INSERT INTO "discount_targets" ("discount_id", "product_target")
SELECT DISTINCT
	"discount_id",
	jsonb_build_object('kind', "product_identity" ->> 'kind')
FROM "discount_product_targets";--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_discount_id_discounts_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_legacy_discount_product_targets"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
	old_product_target jsonb;
	new_product_target jsonb;
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		old_product_target := jsonb_build_object(
			'kind',
			OLD."product_identity" ->> 'kind'
		);

		IF NOT EXISTS (
			SELECT 1
			FROM "discount_product_targets"
			WHERE "discount_id" = OLD."discount_id"
				AND jsonb_build_object(
					'kind',
					"product_identity" ->> 'kind'
				) = old_product_target
		) THEN
			DELETE FROM "discount_targets"
			WHERE "discount_id" = OLD."discount_id"
				AND "product_target" = old_product_target;
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		new_product_target := jsonb_build_object(
			'kind',
			NEW."product_identity" ->> 'kind'
		);

		INSERT INTO "discount_targets" ("discount_id", "product_target")
		VALUES (NEW."discount_id", new_product_target)
		ON CONFLICT ("discount_id", "product_target") DO NOTHING;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;

	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "sync_legacy_discount_product_targets"
AFTER INSERT OR UPDATE OR DELETE
ON "discount_product_targets"
FOR EACH ROW
EXECUTE FUNCTION "sync_legacy_discount_product_targets"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_discount_targets_to_legacy"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		DELETE FROM "discount_product_targets"
		WHERE "discount_id" = OLD."discount_id"
			AND jsonb_build_object(
				'kind',
				"product_identity" ->> 'kind'
			) = OLD."product_target";
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		IF NEW."product_target" ->> 'kind' = 'cowork' THEN
			INSERT INTO "discount_product_targets" (
				"discount_id",
				"product_identity"
			)
			SELECT
				NEW."discount_id",
				identity."product_identity"
			FROM (
				VALUES
					(jsonb_build_object('kind', 'cowork', 'tier', 'basic')),
					(jsonb_build_object('kind', 'cowork', 'tier', 'plus')),
					(jsonb_build_object('kind', 'cowork', 'tier', 'profi'))
			) AS identity("product_identity")
			ON CONFLICT ("discount_id", "product_identity") DO NOTHING;
		ELSIF NEW."product_target" ->> 'kind' = 'meeting-room' THEN
			INSERT INTO "discount_product_targets" (
				"discount_id",
				"product_identity"
			)
			SELECT
				NEW."discount_id",
				identity."product_identity"
			FROM (
				VALUES
					(jsonb_build_object(
						'kind', 'meeting-room',
						'duration', jsonb_build_object('unit', 'hour', 'amount', 1)
					)),
					(jsonb_build_object(
						'kind', 'meeting-room',
						'duration', jsonb_build_object('unit', 'hour', 'amount', 4)
					)),
					(jsonb_build_object(
						'kind', 'meeting-room',
						'duration', jsonb_build_object('unit', 'day', 'amount', 1)
					))
			) AS identity("product_identity")
			ON CONFLICT ("discount_id", "product_identity") DO NOTHING;
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;

	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "sync_discount_targets_to_legacy"
AFTER INSERT OR UPDATE OR DELETE
ON "discount_targets"
FOR EACH ROW
EXECUTE FUNCTION "sync_discount_targets_to_legacy"();
