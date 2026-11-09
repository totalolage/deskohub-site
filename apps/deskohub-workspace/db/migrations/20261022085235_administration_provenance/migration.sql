CREATE TABLE "administration_actions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"failure" text,
	"actor_account_id" text,
	"actor_account_email" text NOT NULL,
	"cli_session_id" text,
	"assistant_connection_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "administration_actions_operation_check" CHECK (btrim("operation") <> ''),
	CONSTRAINT "administration_actions_outcome_check" CHECK ("outcome" in ('started', 'succeeded', 'replayed', 'failed', 'defect', 'interrupted')),
	CONSTRAINT "administration_actions_failure_check" CHECK (("outcome" = 'failed') = ("failure" is not null)),
	CONSTRAINT "administration_actions_finished_check" CHECK (("outcome" = 'started') = ("finished_at" is null)
        and ("finished_at" is null or "finished_at" >= "started_at")),
	CONSTRAINT "administration_actions_email_check" CHECK (btrim("actor_account_email") <> ''),
	CONSTRAINT "administration_actions_channel_check" CHECK (num_nonnulls("cli_session_id", "assistant_connection_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "administrator_assistant_connections" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"approved_by_account_id" text,
	"approved_by_account_email" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administrator_assistant_connections_email_check" CHECK (btrim("approved_by_account_email") <> ''),
	CONSTRAINT "administrator_assistant_connections_client_check" CHECK (btrim("oauth_client_id") <> '' and btrim("client_name") <> ''),
	CONSTRAINT "administrator_assistant_connections_last_used_check" CHECK ("last_used_at" >= "created_at")
);
--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" DROP CONSTRAINT "cli_mutation_requests_pk";--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" ADD COLUMN "assistant_connection_id" text;--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "administrator_assistant_connections_account_client_idx" ON "administrator_assistant_connections" ("approved_by_account_id","oauth_client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_mutation_requests_session_request_idx" ON "cli_mutation_requests" ("session_id","request_id") WHERE "session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_mutation_requests_assistant_connection_request_idx" ON "cli_mutation_requests" ("assistant_connection_id","request_id") WHERE "assistant_connection_id" is not null;--> statement-breakpoint
ALTER TABLE "administration_actions" ADD CONSTRAINT "administration_actions_actor_account_id_user_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "administration_actions" ADD CONSTRAINT "administration_actions_cli_session_id_cli_sessions_id_fkey" FOREIGN KEY ("cli_session_id") REFERENCES "cli_sessions"("id");--> statement-breakpoint
ALTER TABLE "administration_actions" ADD CONSTRAINT "administration_actions_CV4kaVBpPah1_fkey" FOREIGN KEY ("assistant_connection_id") REFERENCES "administrator_assistant_connections"("id");--> statement-breakpoint
ALTER TABLE "administrator_assistant_connections" ADD CONSTRAINT "administrator_assistant_connections_a5oBl0WiKhQa_fkey" FOREIGN KEY ("approved_by_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" ADD CONSTRAINT "cli_mutation_requests_mOHiwUUJHzIg_fkey" FOREIGN KEY ("assistant_connection_id") REFERENCES "administrator_assistant_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" ADD CONSTRAINT "cli_mutation_requests_owner_check" CHECK (num_nonnulls("session_id", "assistant_connection_id") = 1);--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" DROP CONSTRAINT "standalone_access_code_attempt_events_source_check", ADD CONSTRAINT "standalone_access_code_attempt_events_source_check" CHECK ("source" in ('admin-ui', 'dhw-cli', 'assistant'));