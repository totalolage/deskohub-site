CREATE TABLE "customer_account_links" (
	"customer_account_id" text PRIMARY KEY,
	"dotypos_customer_id" text NOT NULL UNIQUE
);
