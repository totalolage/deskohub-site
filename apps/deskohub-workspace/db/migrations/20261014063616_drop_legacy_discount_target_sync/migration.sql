-- The legacy discount_product_targets mirror only understood family targets.
-- Its sync triggers widen every cowork tier target to a broad cowork target,
-- so they must go before tier-targeted discounts can be stored. Dropping each
-- trigger function with CASCADE removes its trigger even where the legacy
-- table is already gone. Existing discount_targets rows are untouched; the
-- orphaned legacy table is left in place and nothing reads it.
DROP FUNCTION IF EXISTS "sync_discount_targets_to_legacy"() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS "sync_legacy_discount_product_targets"() CASCADE;
