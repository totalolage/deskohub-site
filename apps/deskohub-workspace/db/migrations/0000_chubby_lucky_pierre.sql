CREATE TABLE "payment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"dotypos_reservation_id" text,
	"security_token" text,
	"checkout_details" jsonb NOT NULL,
	"payment_status" text NOT NULL,
	"fulfillment_status" text NOT NULL,
	"last_webhook_event_id" text,
	"last_provider_operation_id" text,
	"last_provider_status" text,
	"failure_code" text,
	"paid_at" timestamp with time zone,
	"reservation_created_at" timestamp with time zone,
	"customer_access_email_sent_at" timestamp with time zone,
	"internal_notification_sent_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfillment_failed_at" timestamp with time zone,
	"fulfillment_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_correlation_id_unique" UNIQUE("correlation_id"),
	CONSTRAINT "payment_orders_provider_check" CHECK ("payment_orders"."provider" in ('nexi')),
	CONSTRAINT "payment_orders_payment_status_check" CHECK ("payment_orders"."payment_status" in ('created', 'payment_pending', 'paid', 'payment_failed', 'cancelled', 'expired')),
	CONSTRAINT "payment_orders_fulfillment_status_check" CHECK ("payment_orders"."fulfillment_status" in ('not_started', 'processing', 'fulfilled', 'failed')),
	CONSTRAINT "payment_orders_paid_at_check" CHECK ("payment_orders"."payment_status" <> 'paid' or "payment_orders"."paid_at" is not null),
	CONSTRAINT "payment_orders_fulfilled_check" CHECK ("payment_orders"."fulfillment_status" <> 'fulfilled' or ("payment_orders"."fulfilled_at" is not null and "payment_orders"."dotypos_reservation_id" is not null)),
	CONSTRAINT "payment_orders_fulfillment_failed_check" CHECK ("payment_orders"."fulfillment_status" <> 'failed' or ("payment_orders"."fulfillment_failed_at" is not null and "payment_orders"."fulfillment_failure_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_order_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"processed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "webhook_events_provider_check" CHECK ("webhook_events"."provider" in ('nexi')),
	CONSTRAINT "webhook_events_status_check" CHECK ("webhook_events"."status" in ('received', 'processed', 'failed')),
	CONSTRAINT "webhook_events_processed_check" CHECK ("webhook_events"."status" <> 'processed' or "webhook_events"."processed_at" is not null),
	CONSTRAINT "webhook_events_failed_check" CHECK ("webhook_events"."status" <> 'failed' or "webhook_events"."error_code" is not null)
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_orders_recovery_idx" ON "payment_orders" USING btree ("payment_status","fulfillment_status");--> statement-breakpoint
CREATE INDEX "payment_orders_dotypos_customer_idx" ON "payment_orders" USING btree ("dotypos_customer_id");--> statement-breakpoint
CREATE INDEX "payment_orders_dotypos_reservation_idx" ON "payment_orders" USING btree ("dotypos_reservation_id") WHERE "payment_orders"."dotypos_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_payment_order_idx" ON "webhook_events" USING btree ("payment_order_id") WHERE "webhook_events"."payment_order_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_idx" ON "webhook_events" USING btree ("status","received_at");