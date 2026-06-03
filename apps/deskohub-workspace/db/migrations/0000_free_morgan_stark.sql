CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
--> statement-breakpoint
CREATE TABLE "legal_evidence_events" (
	"id" text DEFAULT uuid_generate_v7()::text PRIMARY KEY NOT NULL,
	"workspace_reservation_id" text,
	"document_key" text NOT NULL,
	"document_path" text NOT NULL,
	"document_hash" text NOT NULL,
	"hash_algorithm" text NOT NULL,
	"accepted" boolean NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"locale" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_evidence_events_hash_algorithm_check" CHECK ("legal_evidence_events"."hash_algorithm" = 'sha256')
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" text DEFAULT uuid_generate_v7()::text PRIMARY KEY NOT NULL,
	"workspace_reservation_id" text,
	"payment_attempt_id" text,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"failure_code" text,
	"dotypos_reservation_id" text,
	"dotypos_customer_id" text,
	"webhook_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_events_severity_check" CHECK ("operational_events"."severity" in ('info', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" text DEFAULT uuid_generate_v7()::text PRIMARY KEY NOT NULL,
	"workspace_reservation_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"security_token" text,
	"state" text NOT NULL,
	"amount_value" integer NOT NULL,
	"amount_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"provider_redirect_url" text,
	"last_webhook_event_id" text,
	"last_provider_operation_id" text,
	"last_provider_status" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_provider_check" CHECK ("payment_attempts"."provider" in ('nexi')),
	CONSTRAINT "payment_attempts_state_check" CHECK ("payment_attempts"."state" in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "payment_attempts_currency_check" CHECK ("payment_attempts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_attempts_failure_code_check" CHECK ("payment_attempts"."state" not in ('failed', 'cancelled', 'expired') or "payment_attempts"."failure_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text DEFAULT uuid_generate_v7()::text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_attempt_id" text,
	"provider_order_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"state" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "webhook_events_provider_check" CHECK ("webhook_events"."provider" in ('nexi')),
	CONSTRAINT "webhook_events_state_check" CHECK ("webhook_events"."state" in ('received', 'processed', 'failed')),
	CONSTRAINT "webhook_events_processed_check" CHECK ("webhook_events"."state" <> 'processed' or "webhook_events"."processed_at" is not null),
	CONSTRAINT "webhook_events_failed_check" CHECK ("webhook_events"."state" <> 'failed' or "webhook_events"."error_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "workspace_reservations" (
	"id" text DEFAULT uuid_generate_v7()::text PRIMARY KEY NOT NULL,
	"reservation_intent_key" text NOT NULL,
	"correlation_id" text DEFAULT uuid_generate_v7()::text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"dotypos_reservation_id" text,
	"customer_access_code" text NOT NULL,
	"reservation_state" text NOT NULL,
	"payment_state" text NOT NULL,
	"fulfillment_state" text NOT NULL,
	"active_payment_attempt_id" text,
	"product_tier" text NOT NULL,
	"product_coffee" boolean NOT NULL,
	"product_monitor_option" text,
	"locale" text NOT NULL,
	"reservation_hold_expires_at" timestamp with time zone,
	"reservation_hold_expired_at" timestamp with time zone,
	"reservation_created_at" timestamp with time zone,
	"reservation_confirmed_at" timestamp with time zone,
	"reservation_cancelled_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfillment_failed_at" timestamp with time zone,
	"failure_code" text,
	"fulfillment_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_reservations_correlation_id_unique" UNIQUE("correlation_id"),
	CONSTRAINT "workspace_reservations_reservation_state_check" CHECK ("workspace_reservations"."reservation_state" in ('draft', 'creating_hold', 'held', 'hold_expired', 'confirming', 'confirmed', 'cancelling', 'cancelled', 'cancellation_failed')),
	CONSTRAINT "workspace_reservations_payment_state_check" CHECK ("workspace_reservations"."payment_state" in ('not_started', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "workspace_reservations_fulfillment_state_check" CHECK ("workspace_reservations"."fulfillment_state" in ('not_started', 'processing', 'fulfilled', 'failed')),
	CONSTRAINT "workspace_reservations_product_tier_check" CHECK ("workspace_reservations"."product_tier" in ('basic', 'plus', 'profi')),
	CONSTRAINT "workspace_reservations_product_monitor_option_check" CHECK ("workspace_reservations"."product_monitor_option" is null or "workspace_reservations"."product_monitor_option" in ('2x27-qhd', '2x32-qhd', '2x27-4k', '2x32-4k')),
	CONSTRAINT "workspace_reservations_locale_check" CHECK ("workspace_reservations"."locale" in ('en-US', 'cs-CZ')),
	CONSTRAINT "workspace_reservations_hold_id_check" CHECK ("workspace_reservations"."reservation_state" not in ('held', 'confirming', 'confirmed', 'cancelling', 'cancelled', 'cancellation_failed') or "workspace_reservations"."dotypos_reservation_id" is not null),
	CONSTRAINT "workspace_reservations_paid_at_check" CHECK ("workspace_reservations"."payment_state" <> 'paid' or "workspace_reservations"."paid_at" is not null),
	CONSTRAINT "workspace_reservations_fulfilled_check" CHECK ("workspace_reservations"."fulfillment_state" <> 'fulfilled' or "workspace_reservations"."fulfilled_at" is not null),
	CONSTRAINT "workspace_reservations_fulfillment_failed_check" CHECK ("workspace_reservations"."fulfillment_state" <> 'failed' or ("workspace_reservations"."fulfillment_failed_at" is not null and "workspace_reservations"."fulfillment_failure_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_workspace_reservation_id_workspace_reservations_id_fk" FOREIGN KEY ("workspace_reservation_id") REFERENCES "public"."workspace_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_workspace_reservation_id_workspace_reservations_id_fk" FOREIGN KEY ("workspace_reservation_id") REFERENCES "public"."workspace_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_workspace_reservation_id_workspace_reservations_id_fk" FOREIGN KEY ("workspace_reservation_id") REFERENCES "public"."workspace_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_evidence_events_workspace_reservation_idx" ON "legal_evidence_events" USING btree ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "operational_events_workspace_reservation_idx" ON "operational_events" USING btree ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "operational_events_payment_attempt_idx" ON "operational_events" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "operational_events_type_created_idx" ON "operational_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "operational_events_severity_created_idx" ON "operational_events" USING btree ("severity","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_order_unique_idx" ON "payment_attempts" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_workspace_reservation_idx" ON "payment_attempts" USING btree ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_state_created_idx" ON "payment_attempts" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_payment_attempt_idx" ON "webhook_events" USING btree ("payment_attempt_id") WHERE "webhook_events"."payment_attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_provider_order_idx" ON "webhook_events" USING btree ("provider_order_id") WHERE "webhook_events"."provider_order_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_state_received_idx" ON "webhook_events" USING btree ("state","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_intent_key_unique_idx" ON "workspace_reservations" USING btree ("reservation_intent_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_dotypos_reservation_unique_idx" ON "workspace_reservations" USING btree ("dotypos_reservation_id") WHERE "workspace_reservations"."dotypos_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "workspace_reservations_states_idx" ON "workspace_reservations" USING btree ("reservation_state","payment_state","fulfillment_state");--> statement-breakpoint
CREATE INDEX "workspace_reservations_expired_holds_idx" ON "workspace_reservations" USING btree ("reservation_hold_expires_at") WHERE "workspace_reservations"."reservation_state" = 'held';--> statement-breakpoint
CREATE INDEX "workspace_reservations_dotypos_customer_idx" ON "workspace_reservations" USING btree ("dotypos_customer_id");
