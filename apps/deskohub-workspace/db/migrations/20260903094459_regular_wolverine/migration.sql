CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "customer_account_links" (
	"customer_account_id" text PRIMARY KEY,
	"dotypos_customer_id" text NOT NULL,
	CONSTRAINT "customer_account_links_customer_check" CHECK (btrim("dotypos_customer_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_account_links_dotypos_customer_unique_idx" ON "customer_account_links" ("dotypos_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_unique_idx" ON "auth"."account" ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "auth"."account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_unique_idx" ON "auth"."rate_limit" ("key");--> statement-breakpoint
CREATE INDEX "rate_limit_last_request_idx" ON "auth"."rate_limit" ("last_request");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique_idx" ON "auth"."session" ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "auth"."session" ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "auth"."session" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique_idx" ON "auth"."user" ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth"."verification" ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "auth"."verification" ("expires_at");--> statement-breakpoint
ALTER TABLE "customer_account_links" ADD CONSTRAINT "customer_account_links_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;