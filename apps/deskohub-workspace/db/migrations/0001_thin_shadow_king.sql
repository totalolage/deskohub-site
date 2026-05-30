CREATE TABLE "checkout_return_state_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"payment_order_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_return_state_tokens" ADD CONSTRAINT "checkout_return_state_tokens_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_return_state_tokens_payment_order_idx" ON "checkout_return_state_tokens" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "checkout_return_state_tokens_active_idx" ON "checkout_return_state_tokens" USING btree ("expires_at") WHERE "checkout_return_state_tokens"."consumed_at" is null;