ALTER TABLE "discount_codes" ADD COLUMN "max_uses_per_customer" integer;--> statement-breakpoint
UPDATE "discount_codes" SET "max_uses_per_customer" = 1 WHERE "max_uses" IS NOT NULL;--> statement-breakpoint
DROP INDEX "discount_code_redemptions_active_customer_unique_idx";--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_max_uses_per_customer_check" CHECK ("max_uses_per_customer" is null or "max_uses_per_customer" > 0);
