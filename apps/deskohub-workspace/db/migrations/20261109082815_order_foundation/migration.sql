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
	CONSTRAINT "orders_kind_check" CHECK ("kind" in ('reservation')),
	CONSTRAINT "orders_payment_state_check" CHECK ("payment_state" in ('not_started', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "orders_fulfillment_state_check" CHECK ("fulfillment_state" in ('not_started', 'processing', 'awaiting_delivery', 'fulfilled', 'failed')),
	CONSTRAINT "orders_dotypos_customer_id_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "orders_paid_at_check" CHECK ("payment_state" <> 'paid' or "paid_at" is not null),
	CONSTRAINT "orders_fulfilled_check" CHECK ("fulfillment_state" <> 'fulfilled' or "fulfilled_at" is not null),
	CONSTRAINT "orders_fulfillment_failed_check" CHECK ("fulfillment_state" <> 'failed' or ("fulfillment_failed_at" is not null and "fulfillment_failure_code" is not null))
);
--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" ("dotypos_customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_states_idx" ON "orders" ("payment_state","fulfillment_state");