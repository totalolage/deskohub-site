CREATE TABLE "request_budget_spends" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"budget_key" text NOT NULL,
	"spent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "request_budget_spends_budget_key_spent_at_idx" ON "request_budget_spends" ("budget_key","spent_at");