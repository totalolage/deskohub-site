CREATE TABLE "customer_accounts" (
	"id" text PRIMARY KEY,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "author_account_id" text;--> statement-breakpoint
CREATE INDEX "workspace_reservations_author_account_idx" ON "workspace_reservations" ("author_account_id");--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_5wO16ktB8eZ1_fkey" FOREIGN KEY ("author_account_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT;