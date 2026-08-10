CREATE TABLE "cli_authentication_requests" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"code_hash" text NOT NULL,
	"challenge" text NOT NULL,
	"client_name" text NOT NULL,
	"cli_version" text NOT NULL,
	"build_target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"grant_token" text,
	"grant_expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"session_id" text,
	CONSTRAINT "cli_authentication_requests_expiry_check" CHECK ("expires_at" > "created_at"),
	CONSTRAINT "cli_authentication_requests_code_hash_check" CHECK ("code_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "cli_authentication_requests_challenge_check" CHECK ("challenge" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "cli_authentication_requests_grant_token_check" CHECK ("grant_token" is null or "grant_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "cli_authentication_requests_build_target_check" CHECK ("build_target" in ('development', 'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64-baseline')),
	CONSTRAINT "cli_authentication_requests_approval_check" CHECK ((
        "approved_at" is null
        and "grant_token" is null
        and "grant_expires_at" is null
      ) or (
        "approved_at" is not null
        and "grant_expires_at" is not null
      )),
	CONSTRAINT "cli_authentication_requests_consumption_check" CHECK ((
        "consumed_at" is null
        and "session_id" is null
      ) or (
        "consumed_at" is not null
        and "session_id" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "cli_sessions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"token_hash" text NOT NULL,
	"client_name" text NOT NULL,
	"cli_version" text NOT NULL,
	"build_target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "cli_sessions_client_name_check" CHECK (char_length(btrim("client_name")) between 1 and 80),
	CONSTRAINT "cli_sessions_cli_version_check" CHECK (char_length("cli_version") between 1 and 32),
	CONSTRAINT "cli_sessions_build_target_check" CHECK ("build_target" in ('development', 'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64-baseline')),
	CONSTRAINT "cli_sessions_token_hash_check" CHECK ("token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "cli_sessions_last_used_check" CHECK ("last_used_at" >= "created_at"),
	CONSTRAINT "cli_sessions_revoked_check" CHECK ("revoked_at" is null or "revoked_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cli_authentication_requests_code_hash_unique_idx" ON "cli_authentication_requests" ("code_hash");--> statement-breakpoint
CREATE INDEX "cli_authentication_requests_expires_at_idx" ON "cli_authentication_requests" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_authentication_requests_session_unique_idx" ON "cli_authentication_requests" ("session_id") WHERE "session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_sessions_token_hash_unique_idx" ON "cli_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "cli_sessions_created_at_idx" ON "cli_sessions" ("created_at");--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" ADD CONSTRAINT "cli_authentication_requests_session_id_cli_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cli_sessions"("id");