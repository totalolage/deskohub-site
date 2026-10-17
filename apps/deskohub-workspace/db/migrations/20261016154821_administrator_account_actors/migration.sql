ALTER TABLE "cli_authentication_requests" ADD COLUMN "approved_by_account_id" text;--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" ADD COLUMN "approved_by_account_email" text;--> statement-breakpoint
ALTER TABLE "cli_sessions" ALTER COLUMN "approved_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ALTER COLUMN "actor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" ADD CONSTRAINT "cli_authentication_requests_approved_by_account_id_user_id_fkey" FOREIGN KEY ("approved_by_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" ADD CONSTRAINT "cli_authentication_requests_approved_by_account_check" CHECK ("approved_by_account_id" is null or ("approved_by_account_email" is not null and btrim("approved_by_account_email") <> ''));--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_approver_check" CHECK ("approved_by" is not null or "approved_by_account_email" is not null);--> statement-breakpoint
ALTER TABLE "standalone_access_code_attempt_events" ADD CONSTRAINT "standalone_access_code_attempt_events_actor_present_check" CHECK ("actor" is not null or "actor_account_email" is not null);--> statement-breakpoint
ALTER TABLE "cli_authentication_requests" DROP CONSTRAINT "cli_authentication_requests_approval_check", ADD CONSTRAINT "cli_authentication_requests_approval_check" CHECK ((
        "approved_at" is null
        and "approved_by" is null
        and "approved_by_account_id" is null
        and "approved_by_account_email" is null
        and "grant_token" is null
        and "grant_expires_at" is null
      ) or (
        "approved_at" is not null
        and "grant_expires_at" is not null
      ));