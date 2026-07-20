ALTER TABLE "discount_product_targets" DROP CONSTRAINT "discount_product_targets_product_key_check";--> statement-breakpoint
ALTER TABLE "discount_product_targets" DROP CONSTRAINT "discount_product_targets_pk";--> statement-breakpoint
ALTER TABLE "discount_product_targets" DROP COLUMN "product_key";--> statement-breakpoint
ALTER TABLE "discount_product_targets" ADD CONSTRAINT "discount_product_targets_pk" PRIMARY KEY("discount_id","product_identity");--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_label_check";--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "label";
