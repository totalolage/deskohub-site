ALTER TABLE "discount_code_redemptions" DROP CONSTRAINT "discount_code_redemptions_code_id_discount_codes_id_fk";--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD COLUMN "kind" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "kind" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "voucher_amount_value" integer;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "voucher_amount_exponent" integer;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "voucher_amount_currency" text;--> statement-breakpoint
ALTER TABLE "discount_codes" ALTER COLUMN "discount_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "discount_code_redemptions_active_customer_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_redemptions_active_customer_unique_idx" ON "discount_code_redemptions" ("code_id","dotypos_customer_id") WHERE ("kind" = 'discount' and "state" in ('reserved', 'redeemed')) or ("kind" = 'voucher' and "state" = 'reserved');--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_id_kind_unique_idx" ON "discount_codes" ("id","kind");--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_code_kind_fk" FOREIGN KEY ("code_id","kind") REFERENCES "discount_codes"("id","kind");--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_kind_check" CHECK ("kind" in ('discount', 'voucher'));--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_kind_check" CHECK ((
        "kind" = 'discount'
        and "discount_id" is not null
        and "voucher_amount_value" is null
        and "voucher_amount_exponent" is null
        and "voucher_amount_currency" is null
      ) or (
        "kind" = 'voucher'
        and "discount_id" is null
        and "max_uses" is null
        and "voucher_amount_value" > 0
        and "voucher_amount_exponent" >= 0
        and "voucher_amount_currency" ~ '^[A-Z]{3}$'
      ));