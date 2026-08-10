CREATE TABLE "cli_mutation_requests" (
	"session_id" text,
	"request_id" text,
	"mutation" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "cli_mutation_requests_pk" PRIMARY KEY("session_id","request_id"),
	CONSTRAINT "cli_mutation_requests_request_id_check" CHECK ("request_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "cli_mutation_requests_completion_check" CHECK ((
        "result" is null
        and "completed_at" is null
      ) or (
        "result" is not null
        and "completed_at" is not null
        and "completed_at" >= "created_at"
      ))
);
--> statement-breakpoint
CREATE INDEX "cli_mutation_requests_created_at_idx" ON "cli_mutation_requests" ("created_at");--> statement-breakpoint
ALTER TABLE "cli_mutation_requests" ADD CONSTRAINT "cli_mutation_requests_session_id_cli_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cli_sessions"("id") ON DELETE CASCADE;