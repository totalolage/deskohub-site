CREATE TABLE "account_role_grants" (
	"account_id" text,
	"role" text,
	"granted_by_account_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_role_grants_pkey" PRIMARY KEY("account_id","role"),
	CONSTRAINT "account_role_grants_role_check" CHECK ("role" in ('administrator'))
);
--> statement-breakpoint
CREATE TABLE "manual_invoice_actors" (
	"invoice_id" text PRIMARY KEY,
	"actor_account_id" text,
	"actor_account_email" text NOT NULL,
	CONSTRAINT "manual_invoice_actors_email_check" CHECK (btrim("actor_account_email") <> '')
);
--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD COLUMN "approved_by_account_id" text;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD COLUMN "approved_by_account_email" text;--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ADD COLUMN "actor_account_id" text;--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ADD COLUMN "actor_account_email" text;--> statement-breakpoint
ALTER TABLE "account_role_grants" ADD CONSTRAINT "account_role_grants_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_role_grants" ADD CONSTRAINT "account_role_grants_granted_by_account_id_user_id_fkey" FOREIGN KEY ("granted_by_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_approved_by_account_id_user_id_fkey" FOREIGN KEY ("approved_by_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "manual_invoice_actors" ADD CONSTRAINT "manual_invoice_actors_invoice_id_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");--> statement-breakpoint
ALTER TABLE "manual_invoice_actors" ADD CONSTRAINT "manual_invoice_actors_actor_account_id_user_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ADD CONSTRAINT "standalone_access_code_attempt_events_Rg7DUJXLu6hM_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_approved_by_account_check" CHECK ("approved_by_account_id" is null or ("approved_by_account_email" is not null and btrim("approved_by_account_email") <> ''));--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ADD CONSTRAINT "standalone_access_code_attempt_events_actor_account_check" CHECK ("actor_account_id" is null or ("actor_account_email" is not null and btrim("actor_account_email") <> ''));