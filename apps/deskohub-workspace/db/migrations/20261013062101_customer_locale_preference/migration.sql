-- The locale pinned for the in-flight customer email idempotency generation:
-- written only while null before a generation's first provider send so failed
-- and accepted-but-unrecorded retries keep a locale-stable idempotency key,
-- and atomically cleared when the accepted send's delivery ID is recorded so
-- the next generation resolves the customer's current locale preference.
-- Idempotent by IF NOT EXISTS (preview databases that applied an earlier
-- revision of this migration already have it); nullable, so no backfill.
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "active_customer_email_delivery_locale" text;--> statement-breakpoint
-- The customer's saved locale preference on the Better Auth user. Nullable:
-- existing accounts have none until their next sign-in captures it.
ALTER TABLE "auth"."user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ'));--> statement-breakpoint
-- Earlier unreleased revisions of this migration created a separate
-- preference table on preview databases; it is never created in production.
DROP TABLE IF EXISTS "customer_locale_preferences";
