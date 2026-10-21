ALTER TABLE "auth"."oauth_access_token" ADD COLUMN "consent_id" text;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD COLUMN "consent_id" text;--> statement-breakpoint
CREATE INDEX "oauth_access_token_consent_id_idx" ON "auth"."oauth_access_token" ("consent_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_consent_id_idx" ON "auth"."oauth_refresh_token" ("consent_id");--> statement-breakpoint
ALTER TABLE "auth"."oauth_access_token" ADD CONSTRAINT "oauth_access_token_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "auth"."oauth_consent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "auth"."oauth_consent"("id") ON DELETE CASCADE;
