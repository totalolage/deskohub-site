CREATE TABLE "mobile_shop_purchase_order_items" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"purchase_order_id" text NOT NULL,
	"dotypos_product_id" text NOT NULL,
	"dotypos_category_id" text NOT NULL,
	"product_version" text NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"locale" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_label" text,
	"unit_price_value" integer NOT NULL,
	"line_total_value" integer NOT NULL,
	"amount_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"tax" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_order_items_quantity_check" CHECK ("quantity" between 1 and 10),
	CONSTRAINT "mobile_shop_purchase_order_items_amount_check" CHECK ("unit_price_value" > 0 and "line_total_value" = "unit_price_value" * "quantity" and "amount_exponent" >= 0 and "currency" = 'CZK'),
	CONSTRAINT "mobile_shop_purchase_order_items_locale_check" CHECK ("locale" in ('cs-CZ', 'en-US'))
);
--> statement-breakpoint
CREATE TABLE "mobile_shop_purchase_orders" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"public_reference" text NOT NULL UNIQUE,
	"correlation_id" text DEFAULT uuid_generate_v7() NOT NULL UNIQUE,
	"dotypos_customer_id" text NOT NULL,
	"authorizing_dotypos_reservation_id" text NOT NULL,
	"checkout_attempt_key" text NOT NULL UNIQUE,
	"cart_fingerprint" text NOT NULL,
	"quote_fingerprint" text NOT NULL,
	"payment_state" text NOT NULL,
	"receipt_state" text NOT NULL,
	"stock_state" text NOT NULL,
	"stock_retry_allowed" boolean DEFAULT false NOT NULL,
	"active_payment_attempt_id" text,
	"total_value" integer NOT NULL,
	"total_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"locale" text NOT NULL,
	"tax_regime" jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"receipt_sent_at" timestamp with time zone,
	"stock_synced_at" timestamp with time zone,
	"payment_failure_code" text,
	"receipt_failure_code" text,
	"stock_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_orders_payment_state_check" CHECK ("payment_state" in ('not_started', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "mobile_shop_purchase_orders_receipt_state_check" CHECK ("receipt_state" in ('not_started', 'processing', 'sent', 'failed')),
	CONSTRAINT "mobile_shop_purchase_orders_stock_state_check" CHECK ("stock_state" in ('not_started', 'processing', 'synced', 'ambiguous', 'failed')),
	CONSTRAINT "mobile_shop_purchase_orders_amount_check" CHECK ("total_value" > 0 and "total_exponent" >= 0 and "currency" = 'CZK'),
	CONSTRAINT "mobile_shop_purchase_orders_locale_check" CHECK ("locale" in ('cs-CZ', 'en-US')),
	CONSTRAINT "mobile_shop_purchase_orders_tax_regime_check" CHECK ("tax_regime"->>'kind' in ('not-vat-payer', 'vat-payer') and nullif("tax_regime"->>'version', '') is not null),
	CONSTRAINT "mobile_shop_purchase_orders_paid_at_check" CHECK ("payment_state" <> 'paid' or "paid_at" is not null),
	CONSTRAINT "mobile_shop_purchase_orders_payment_failure_check" CHECK ("payment_state" not in ('failed', 'cancelled', 'expired') or "payment_failure_code" is not null),
	CONSTRAINT "mobile_shop_purchase_orders_stock_retry_check" CHECK ("stock_retry_allowed" = false or ("payment_state" = 'paid' and "stock_state" = 'failed'))
);
--> statement-breakpoint
CREATE TABLE "mobile_shop_purchase_payment_attempts" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"purchase_order_id" text NOT NULL,
	"provider_order_id" text,
	"security_token" text,
	"provider_redirect_url" text,
	"state" text NOT NULL,
	"amount_value" integer NOT NULL,
	"amount_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"last_webhook_event_id" text,
	"last_provider_operation_id" text,
	"last_provider_status" text,
	"failure_code" text,
	"provider_order_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_payment_attempts_state_check" CHECK ("state" in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "mobile_shop_purchase_payment_attempts_amount_check" CHECK ("amount_value" > 0 and "amount_exponent" >= 0 and "currency" = 'CZK'),
	CONSTRAINT "mobile_shop_purchase_payment_attempts_failure_check" CHECK ("state" not in ('failed', 'cancelled', 'expired') or "failure_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "mobile_shop_purchase_receipt_deliveries" (
	"purchase_order_id" text PRIMARY KEY,
	"idempotency_key" text NOT NULL UNIQUE,
	"provider_message_id" text UNIQUE,
	"state" text NOT NULL,
	"result_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_receipt_deliveries_state_check" CHECK ("state" in ('not_started', 'processing', 'sent', 'failed')),
	CONSTRAINT "mobile_shop_purchase_receipt_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mobile_shop_purchase_stock_attempts" (
	"purchase_order_id" text PRIMARY KEY,
	"warehouse_id" text,
	"provider_reference" text UNIQUE,
	"state" text NOT NULL,
	"result_code" text,
	"retry_allowed" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_stock_attempts_state_check" CHECK ("state" in ('not_started', 'processing', 'synced', 'ambiguous', 'failed')),
	CONSTRAINT "mobile_shop_purchase_stock_attempts_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "mobile_shop_purchase_stock_attempts_retry_check" CHECK ("retry_allowed" = false or "state" = 'failed'),
	CONSTRAINT "mobile_shop_purchase_stock_attempts_synced_warehouse_check" CHECK ("state" <> 'synced' or "warehouse_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "mobile_shop_purchase_webhook_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"provider_event_id" text NOT NULL UNIQUE,
	"purchase_order_id" text,
	"payment_attempt_id" text,
	"state" text NOT NULL,
	"result_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_shop_purchase_webhook_events_state_check" CHECK ("state" in ('received', 'processing', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_shop_purchase_order_items_product_unique_idx" ON "mobile_shop_purchase_order_items" ("purchase_order_id","dotypos_product_id");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_order_items_order_idx" ON "mobile_shop_purchase_order_items" ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_orders_customer_created_idx" ON "mobile_shop_purchase_orders" ("dotypos_customer_id","created_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_orders_payment_created_idx" ON "mobile_shop_purchase_orders" ("payment_state","created_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_orders_stock_updated_idx" ON "mobile_shop_purchase_orders" ("stock_state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_shop_purchase_payment_attempts_provider_order_unique_idx" ON "mobile_shop_purchase_payment_attempts" ("provider_order_id") WHERE "provider_order_id" is not null;--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_payment_attempts_order_idx" ON "mobile_shop_purchase_payment_attempts" ("purchase_order_id","created_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_payment_attempts_state_idx" ON "mobile_shop_purchase_payment_attempts" ("state","created_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_receipt_deliveries_state_idx" ON "mobile_shop_purchase_receipt_deliveries" ("state","updated_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_stock_attempts_state_idx" ON "mobile_shop_purchase_stock_attempts" ("state","updated_at");--> statement-breakpoint
CREATE INDEX "mobile_shop_purchase_webhook_events_state_idx" ON "mobile_shop_purchase_webhook_events" ("state","received_at");--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_order_items" ADD CONSTRAINT "mobile_shop_purchase_order_items_AJEcvZIGqgBA_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "mobile_shop_purchase_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_payment_attempts" ADD CONSTRAINT "mobile_shop_purchase_payment_attempts_sFyshKGg40E0_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "mobile_shop_purchase_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_receipt_deliveries" ADD CONSTRAINT "mobile_shop_purchase_receipt_deliveries_ORWnuXpM407y_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "mobile_shop_purchase_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_stock_attempts" ADD CONSTRAINT "mobile_shop_purchase_stock_attempts_MFqrOOaOjlnc_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "mobile_shop_purchase_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_webhook_events" ADD CONSTRAINT "mobile_shop_purchase_webhook_events_4RGUVqhZJXEQ_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "mobile_shop_purchase_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mobile_shop_purchase_webhook_events" ADD CONSTRAINT "mobile_shop_purchase_webhook_events_0cLjHUNT7xP0_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "mobile_shop_purchase_payment_attempts"("id") ON DELETE RESTRICT;
