ALTER TABLE "payment_orders" ADD COLUMN "reservation_submit_key" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "dotypos_reservation_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_hold_expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_cancellation_failure_code" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "reservation_cancellation_failure_message" text;--> statement-breakpoint
UPDATE "payment_orders" SET "dotypos_reservation_status" = 'CONFIRMED', "reservation_confirmed_at" = COALESCE("paid_at", "updated_at", "created_at") WHERE "dotypos_reservation_id" is not null;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_dotypos_reservation_status_check" CHECK ("payment_orders"."dotypos_reservation_status" in ('none', 'creating', 'NEW', 'cancellation_pending', 'CANCELLED', 'CONFIRMED'));--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_reservation_submit_key_unique_idx" ON "payment_orders" USING btree ("reservation_submit_key") WHERE "payment_orders"."reservation_submit_key" is not null;--> statement-breakpoint
CREATE INDEX "payment_orders_expired_reservation_holds_idx" ON "payment_orders" USING btree ("reservation_hold_expires_at") WHERE "payment_orders"."dotypos_reservation_status" = 'NEW' and "payment_orders"."reservation_hold_expires_at" is not null;
