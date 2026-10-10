ALTER TABLE "cli_authentication_requests" ADD COLUMN "session_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" ADD CONSTRAINT "cli_authentication_requests_session_expiry_check" CHECK ("session_expires_at" is null or (
        "approved_at" is not null
        and "session_expires_at" > "approved_at"
      ));--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_expiry_check" CHECK ("expires_at" is null or "expires_at" > "created_at");