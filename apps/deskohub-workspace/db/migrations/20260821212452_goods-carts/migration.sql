CREATE TABLE "goods_cart_items" (
	"cart_id" text,
	"product_id" text,
	"quantity" integer NOT NULL,
	CONSTRAINT "goods_cart_items_pk" PRIMARY KEY("cart_id","product_id"),
	CONSTRAINT "goods_cart_items_product_check" CHECK (btrim("product_id") <> ''),
	CONSTRAINT "goods_cart_items_quantity_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_carts" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"dotypos_customer_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_carts_customer_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "goods_carts_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX "goods_cart_items_cart_idx" ON "goods_cart_items" ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_carts_customer_unique_idx" ON "goods_carts" ("dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "goods_cart_items" ADD CONSTRAINT "goods_cart_items_cart_id_goods_carts_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "goods_carts"("id") ON DELETE CASCADE;