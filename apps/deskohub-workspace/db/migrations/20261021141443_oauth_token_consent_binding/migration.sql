ALTER TABLE "auth"."oauth_access_token" ADD COLUMN "consent_id" text;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD COLUMN "consent_id" text;--> statement-breakpoint
CREATE INDEX "oauth_access_token_consent_id_idx" ON "auth"."oauth_access_token" ("consent_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_consent_id_idx" ON "auth"."oauth_refresh_token" ("consent_id");--> statement-breakpoint
ALTER TABLE "auth"."oauth_access_token" ADD CONSTRAINT "oauth_access_token_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "auth"."oauth_consent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "auth"."oauth_consent"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Existing tokens take the consent that authorized them: their client's only
-- consent for the customer and reference, when it is no newer than the token.
-- A token of a client that asks for consent with no such consent, or with
-- several, stays unbound and no longer works; presenting it, or the daily auth
-- cleanup once it expires, deletes it.
UPDATE "auth"."oauth_access_token" AS "token" SET "consent_id" = "consent"."id"
FROM "auth"."oauth_consent" AS "consent"
WHERE "consent"."client_id" = "token"."client_id"
  AND "consent"."user_id" = "token"."user_id"
  AND "consent"."reference_id" IS NOT DISTINCT FROM "token"."reference_id"
  AND "consent"."created_at" <= "token"."created_at"
  AND NOT EXISTS (
    SELECT 1 FROM "auth"."oauth_consent" AS "other"
    WHERE "other"."id" <> "consent"."id"
      AND "other"."client_id" = "token"."client_id"
      AND "other"."user_id" = "token"."user_id"
      AND "other"."reference_id" IS NOT DISTINCT FROM "token"."reference_id"
  );
--> statement-breakpoint
-- Refresh tokens are bound the same way.
UPDATE "auth"."oauth_refresh_token" AS "token" SET "consent_id" = "consent"."id"
FROM "auth"."oauth_consent" AS "consent"
WHERE "consent"."client_id" = "token"."client_id"
  AND "consent"."user_id" = "token"."user_id"
  AND "consent"."reference_id" IS NOT DISTINCT FROM "token"."reference_id"
  AND "consent"."created_at" <= "token"."created_at"
  AND NOT EXISTS (
    SELECT 1 FROM "auth"."oauth_consent" AS "other"
    WHERE "other"."id" <> "consent"."id"
      AND "other"."client_id" = "token"."client_id"
      AND "other"."user_id" = "token"."user_id"
      AND "other"."reference_id" IS NOT DISTINCT FROM "token"."reference_id"
  );
