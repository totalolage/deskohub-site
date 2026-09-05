UPDATE "cli_sessions" SET "approved_by" = 'admin' WHERE "approved_by" IS NULL;--> statement-breakpoint
ALTER TABLE "cli_sessions" ALTER COLUMN "approved_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_sessions" DROP CONSTRAINT "cli_sessions_approved_by_check", ADD CONSTRAINT "cli_sessions_approved_by_check" CHECK ("approved_by" ~ '^[a-z0-9][a-z0-9._-]{0,79}$');