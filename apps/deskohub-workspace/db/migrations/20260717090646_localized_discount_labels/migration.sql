ALTER TABLE "discounts" ADD COLUMN "labels" jsonb;--> statement-breakpoint
UPDATE "discounts"
SET "labels" = jsonb_build_object(
	'en-US', '50% summer discount',
	'cs-CZ', 'Letní sleva 50 %'
)
WHERE "id" = '019f6f31-d00f-7a94-86fa-764f425e7fab';--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "discounts"
		WHERE (
			CASE
				WHEN
					"labels" IS NOT NULL
					AND jsonb_typeof("labels") = 'object'
				THEN
					"labels" ?& ARRAY['en-US', 'cs-CZ']::text[]
					AND ("labels" - ARRAY['en-US', 'cs-CZ']::text[]) = '{}'::jsonb
					AND jsonb_typeof("labels" -> 'en-US') = 'string'
					AND jsonb_typeof("labels" -> 'cs-CZ') = 'string'
					AND ("labels" ->> 'en-US') <> ''
					AND ("labels" ->> 'cs-CZ') <> ''
					AND ("labels" ->> 'en-US') = btrim("labels" ->> 'en-US')
					AND ("labels" ->> 'cs-CZ') = btrim("labels" ->> 'cs-CZ')
					AND ("labels" ->> 'en-US') !~ '^[[:space:]]|[[:space:]]$'
					AND ("labels" ->> 'cs-CZ') !~ '^[[:space:]]|[[:space:]]$'
				ELSE false
			END
		) IS NOT TRUE
	) THEN
		RAISE EXCEPTION
			'Every discounts row must contain exactly trimmed, non-empty en-US and cs-CZ labels';
	END IF;
END
$migration$;--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "labels" SET NOT NULL;
