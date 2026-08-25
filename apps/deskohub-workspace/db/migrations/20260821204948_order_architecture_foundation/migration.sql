CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"order_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"product_identity" jsonb NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_value" integer NOT NULL,
	"undiscounted_total_value" integer NOT NULL,
	"payable_total_value" integer NOT NULL,
	"amount_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_sequence_check" CHECK ("sequence" >= 0),
	CONSTRAINT "order_lines_product_identity_check" CHECK (jsonb_typeof("product_identity") = 'object'
        and jsonb_typeof("product_identity"->'kind') = 'string'
        and btrim("product_identity"->>'kind') <> ''),
	CONSTRAINT "order_lines_description_check" CHECK (btrim("description") <> ''),
	CONSTRAINT "order_lines_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "order_lines_money_check" CHECK ("unit_price_value" >= 0
        and "undiscounted_total_value" = "unit_price_value" * "quantity"
        and "payable_total_value" >= 0
        and "payable_total_value" <= "undiscounted_total_value"),
	CONSTRAINT "order_lines_amount_exponent_check" CHECK ("amount_exponent" = 2),
	CONSTRAINT "order_lines_currency_check" CHECK ("currency" = 'CZK')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"kind" text NOT NULL,
	"correlation_id" text DEFAULT uuid_generate_v7() NOT NULL UNIQUE,
	"dotypos_customer_id" text NOT NULL,
	"payment_state" text NOT NULL,
	"fulfillment_state" text NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfillment_failed_at" timestamp with time zone,
	"fulfillment_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_kind_check" CHECK ("kind" in ('reservation', 'goods')),
	CONSTRAINT "orders_payment_state_check" CHECK ("payment_state" in ('not_started', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "orders_fulfillment_state_check" CHECK ("fulfillment_state" in ('not_started', 'processing', 'fulfilled', 'failed')),
	CONSTRAINT "orders_dotypos_customer_id_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "orders_paid_at_check" CHECK ("payment_state" <> 'paid' or "paid_at" is not null),
	CONSTRAINT "orders_fulfilled_check" CHECK ("fulfillment_state" <> 'fulfilled' or "fulfilled_at" is not null),
	CONSTRAINT "orders_fulfillment_failed_check" CHECK ("fulfillment_state" <> 'failed' or ("fulfillment_failed_at" is not null and "fulfillment_failure_code" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_sequence_unique_idx" ON "order_lines" ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" ("order_id");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" ("dotypos_customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_states_idx" ON "orders" ("payment_state","fulfillment_state");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_order_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'order lines are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_immutable
BEFORE UPDATE OR DELETE ON "order_lines"
FOR EACH ROW
EXECUTE FUNCTION reject_order_line_mutation();
