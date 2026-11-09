-- Rewrites stored audience filters from the legacy per-tag conditions to
-- attribute-catalogue conditions. Groups keep their shape and are walked
-- recursively; conditions already in the new shape pass through, so the
-- rewrite is idempotent. An unknown node aborts the migration instead of
-- leaving a filter Workspace can no longer decode.
CREATE FUNCTION "audience_filter_to_attribute_conditions"("node" jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  "period" jsonb;
  "params" jsonb;
BEGIN
  IF "node"->>'_tag' = 'Condition' THEN
    RETURN "node";
  ELSIF "node"->>'_tag' = 'Group' THEN
    RETURN jsonb_set(
      "node",
      '{filters}',
      COALESCE(
        (
          SELECT jsonb_agg(
            "audience_filter_to_attribute_conditions"("filter")
            ORDER BY "position"
          )
          FROM jsonb_array_elements("node"->'filters')
            WITH ORDINALITY AS "filters"("filter", "position")
        ),
        '[]'::jsonb
      )
    );
  ELSIF "node"->>'_tag' = 'Reservation' AND "node"->>'presence' IN ('has', 'hasNot') THEN
    "period" := CASE
      WHEN "node" ? 'from' AND "node" ? 'to' THEN
        jsonb_build_object('_tag', 'Range', 'from', "node"->'from', 'to', "node"->'to')
      WHEN "node" ? 'from' THEN
        jsonb_build_object('_tag', 'Onward', 'date', "node"->'from')
      WHEN "node" ? 'to' THEN
        jsonb_build_object('_tag', 'Until', 'date', "node"->'to')
      ELSE
        jsonb_build_object('_tag', 'AnyTime')
    END;
    "params" := jsonb_build_object('dateBasis', "node"->'dateBasis', 'period', "period");
    IF "node" ? 'status' THEN
      "params" := "params" || jsonb_build_object('status', "node"->'status');
    END IF;
    RETURN jsonb_build_object(
      'attribute', 'reservationCount',
      '_tag', 'Condition',
      'params', "params",
      'operator', CASE WHEN "node"->>'presence' = 'has' THEN 'gt' ELSE 'eq' END,
      'value', 0
    );
  ELSIF "node"->>'_tag' = 'Locale' THEN
    RETURN jsonb_build_object(
      'attribute', 'locale',
      '_tag', 'Condition',
      'operator', 'anyOf',
      'value', "node"->'locales'
    );
  ELSIF "node"->>'_tag' = 'Account' THEN
    RETURN jsonb_build_object(
      'attribute', 'hasAccount',
      '_tag', 'Condition',
      'operator', 'is',
      'value', "node"->'hasAccount'
    );
  ELSIF "node"->>'_tag' = 'DotyposTag' THEN
    RETURN jsonb_build_object(
      'attribute', 'dotyposTags',
      '_tag', 'Condition',
      'operator', 'anyOf',
      'value', jsonb_build_array("node"->'tag')
    );
  ELSIF "node"->>'_tag' = 'DiscountGroup' THEN
    RETURN jsonb_build_object(
      'attribute', 'discountGroup',
      '_tag', 'Condition',
      'operator', 'anyOf',
      'value', jsonb_build_array("node"->'discountGroupId')
    );
  END IF;
  RAISE EXCEPTION 'Unknown audience filter node: %', "node";
END;
$$;
--> statement-breakpoint
UPDATE "email_campaign_audiences"
SET "filter" = "audience_filter_to_attribute_conditions"("filter")
WHERE "filter" IS DISTINCT FROM "audience_filter_to_attribute_conditions"("filter");
--> statement-breakpoint
UPDATE "email_campaign_sends"
SET "audience_filter" = "audience_filter_to_attribute_conditions"("audience_filter")
WHERE "audience_filter" IS DISTINCT FROM "audience_filter_to_attribute_conditions"("audience_filter");
--> statement-breakpoint
-- An audience-create request stores the filter it was sent and the audience
-- it returned. A retry must match the stored request and replay the stored
-- audience, which Workspace decodes with the new filter schema.
UPDATE "cli_mutation_requests"
SET
  "mutation" = jsonb_set(
    "mutation",
    '{audience,filter}',
    "audience_filter_to_attribute_conditions"("mutation" #> '{audience,filter}')
  ),
  "result" = CASE
    WHEN "result" ? 'filter' THEN jsonb_set(
      "result",
      '{filter}',
      "audience_filter_to_attribute_conditions"("result"->'filter')
    )
    ELSE "result"
  END
WHERE "mutation"->>'kind' = 'campaign-audience-create'
  AND (
    "mutation" #> '{audience,filter}'
      IS DISTINCT FROM "audience_filter_to_attribute_conditions"("mutation" #> '{audience,filter}')
    OR (
      "result" ? 'filter'
      AND "result"->'filter'
        IS DISTINCT FROM "audience_filter_to_attribute_conditions"("result"->'filter')
    )
  );
--> statement-breakpoint
DROP FUNCTION "audience_filter_to_attribute_conditions"(jsonb);
