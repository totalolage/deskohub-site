ALTER TABLE "discount_code_redemptions" ADD COLUMN "applied_amount_value" integer;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD COLUMN "applied_amount_value" integer;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ALTER COLUMN "application_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ALTER COLUMN "application_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "discount_code_redemptions" AS claim
SET "applied_amount_value" = application."applied_amount_value"
FROM "discount_applications" AS application
WHERE claim."application_id" = application."id"
  AND claim."applied_amount_value" IS NULL;--> statement-breakpoint
UPDATE "voucher_redemptions" AS claim
SET "applied_amount_value" = application."applied_amount_value"
FROM "discount_applications" AS application
WHERE claim."application_id" = application."id"
  AND claim."applied_amount_value" IS NULL;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_application_check" CHECK ("application_id" is not null or (
        "order_id" is not null
        and "payment_attempt_id" is null
        and "applied_amount_value" is not null
        and "applied_amount_value" > 0
      ));--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_applied_amount_check" CHECK ("applied_amount_value" is null or "applied_amount_value" > 0);--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_application_check" CHECK ("application_id" is not null or (
        "order_id" is not null
        and "payment_attempt_id" is null
        and "applied_amount_value" is not null
        and "applied_amount_value" > 0
      ));--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_applied_amount_check" CHECK ("applied_amount_value" is null or "applied_amount_value" > 0);
