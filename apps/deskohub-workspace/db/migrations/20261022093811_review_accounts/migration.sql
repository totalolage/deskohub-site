CREATE TABLE "review_account_holds" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"account_id" text NOT NULL,
	"agent_client_id" text,
	"checkout_session_key" text NOT NULL,
	"selection_key" text NOT NULL,
	"reservation_details" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"seats" integer NOT NULL,
	"total_value" integer NOT NULL,
	"total_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"booked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "review_account_holds_seats_check" CHECK ("seats" > 0),
	CONSTRAINT "review_account_holds_total_check" CHECK ("total_value" >= 0),
	CONSTRAINT "review_account_holds_interval_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "review_account_holds_expiry_check" CHECK ("expires_at" > "booked_at")
);
--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD COLUMN "review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "review_account_holds_account_session_idx" ON "review_account_holds" ("account_id","checkout_session_key");--> statement-breakpoint
ALTER TABLE "review_account_holds" ADD CONSTRAINT "review_account_holds_account_id_customer_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_review_without_dotypos_customer_check" CHECK (not "review" or "dotypos_customer_id" is null);